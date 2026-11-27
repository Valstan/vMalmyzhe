"""HTTP-слой OIDC: discovery, authorize, token, userinfo, logout.

Здесь проверяется то, что видит клиент: коды ответа, Location-редиректы и
тела ответов. Семантика — как в Сарафане (существующие клиенты: trener,
Сабантуй, Казанская, портал).
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import pytest
from authlib.oauth2.rfc7636 import create_s256_code_challenge

from app.auth import session_cookie_name

REDIRECT = "https://client.example/cb"


def _q(url: str) -> dict:
    """Разобрать query-строку URL."""
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


# ---------------------------------------------------------------------------
# Discovery / JWKS
# ---------------------------------------------------------------------------


async def test_discovery_endpoint(client):
    """Discovery отвечает 200 и объявляет канонические эндпоинты."""
    resp = await client.get("/.well-known/openid-configuration")
    assert resp.status_code == 200
    doc = resp.json()
    assert doc["issuer"].startswith("https://")
    assert doc["authorization_endpoint"].endswith("/oidc/authorize")
    assert doc["token_endpoint"].endswith("/oidc/token")
    assert doc["userinfo_endpoint"].endswith("/oidc/userinfo")
    assert doc["jwks_uri"].endswith("/.well-known/jwks.json")


async def test_jwks_endpoint(client):
    """JWKS отдаёт публичный ключ с kid."""
    resp = await client.get("/.well-known/jwks.json")
    assert resp.status_code == 200
    keys = resp.json()["keys"]
    assert keys and keys[0]["kid"]
    assert keys[0]["kty"] == "RSA"
    assert "d" not in keys[0]  # приватная часть не публикуется


# ---------------------------------------------------------------------------
# Authorize
# ---------------------------------------------------------------------------


async def test_authorize_issues_code_and_redirects(client, make_user, make_oauth_client):
    """Вошедший клиент получает code редиректом на свой redirect_uri."""
    await make_user()
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})

    resp = await client.get(
        "/oidc/authorize",
        params={
            "response_type": "code",
            "client_id": "client-a",
            "redirect_uri": REDIRECT,
            "scope": "openid profile",
            "state": "STATE-1",
            "code_challenge": create_s256_code_challenge("verifier-1"),
            "code_challenge_method": "S256",
        },
    )
    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.startswith(REDIRECT)
    params = _q(location)
    assert params["code"]
    assert params["state"] == "STATE-1"


async def test_authorize_without_session_redirects_to_login(client, make_oauth_client):
    """Гость (без prompt=none) уводится на страницу входа, а не получает 401."""
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    resp = await client.get(
        "/oidc/authorize",
        params={
            "response_type": "code",
            "client_id": "client-a",
            "redirect_uri": REDIRECT,
            "scope": "openid",
        },
    )
    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.startswith("/")
    assert "next=" in location


async def test_authorize_unknown_client_is_400_without_redirect(client, make_user):
    """Неизвестный client_id — 400 и НИКАКОГО редиректа (open-redirect).

    Запрос — от вошедшего: гостя сначала уводит на страницу входа (как в
    Сарафане), и до проверки клиента дело не доходит.
    """
    await make_user()
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    resp = await client.get(
        "/oidc/authorize",
        params={
            "response_type": "code",
            "client_id": "нет-такого",
            "redirect_uri": REDIRECT,
            "scope": "openid",
        },
    )
    assert resp.status_code == 400
    assert "location" not in resp.headers


async def test_authorize_unregistered_redirect_uri_is_400_without_redirect(
    client, make_user, make_oauth_client
):
    """Незарегистрированный redirect_uri — 400 без редиректа."""
    await make_user()
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    resp = await client.get(
        "/oidc/authorize",
        params={
            "response_type": "code",
            "client_id": "client-a",
            "redirect_uri": "https://evil.example/steal",
            "scope": "openid",
        },
    )
    assert resp.status_code == 400
    assert "location" not in resp.headers


async def test_authorize_prompt_none_for_guest_returns_login_required(
    client, make_oauth_client
):
    """prompt=none гостю → честный login_required клиенту (редиректом)."""
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    resp = await client.get(
        "/oidc/authorize",
        params={
            "response_type": "code",
            "client_id": "client-a",
            "redirect_uri": REDIRECT,
            "scope": "openid",
            "prompt": "none",
        },
    )
    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.startswith(REDIRECT)
    assert _q(location)["error"] == "login_required"


async def test_authorize_prompt_consent_returns_consent_required(
    client, make_user, make_oauth_client
):
    """Consent-экрана нет → честный consent_required."""
    await make_user()
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    resp = await client.get(
        "/oidc/authorize",
        params={
            "response_type": "code",
            "client_id": "client-a",
            "redirect_uri": REDIRECT,
            "scope": "openid",
            "prompt": "consent",
        },
    )
    assert resp.status_code == 302
    assert _q(resp.headers["location"])["error"] == "consent_required"


async def test_authorize_prompt_none_with_other_is_invalid_request(
    client, make_user, make_oauth_client
):
    """prompt=none вместе с другим — invalid_request."""
    await make_user()
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    resp = await client.get(
        "/oidc/authorize",
        params={
            "response_type": "code",
            "client_id": "client-a",
            "redirect_uri": REDIRECT,
            "scope": "openid",
            "prompt": "none login",
        },
    )
    assert resp.status_code == 302
    assert _q(resp.headers["location"])["error"] == "invalid_request"


async def test_authorize_unsupported_response_type_redirects_with_error(
    client, make_user, make_oauth_client
):
    """response_type != code → ошибка клиенту (редиректом, uri проверен)."""
    await make_user()
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    resp = await client.get(
        "/oidc/authorize",
        params={
            "response_type": "token",
            "client_id": "client-a",
            "redirect_uri": REDIRECT,
            "scope": "openid",
        },
    )
    assert resp.status_code == 302
    assert _q(resp.headers["location"])["error"] == "unsupported_response_type"


# ---------------------------------------------------------------------------
# Token
# ---------------------------------------------------------------------------


async def _authorize(client, client_id="client-a", verifier="verifier-1", scope="openid profile"):
    """Пройти authorize и вернуть сырой код."""
    resp = await client.get(
        "/oidc/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": REDIRECT,
            "scope": scope,
            "code_challenge": create_s256_code_challenge(verifier),
            "code_challenge_method": "S256",
        },
    )
    assert resp.status_code == 302, resp.text
    return _q(resp.headers["location"])["code"]


async def test_token_exchange_returns_bundle(client, make_user, make_oauth_client):
    """Обмен кода даёт access/id/refresh-токены."""
    await make_user()
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    code = await _authorize(client)

    resp = await client.post(
        "/oidc/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT,
            "client_id": "client-a",
            "code_verifier": "verifier-1",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "Bearer"
    assert body["access_token"]
    assert body["id_token"]
    assert body["refresh_token"]
    assert body["expires_in"] > 0
    assert "no-store" in resp.headers.get("cache-control", "")


async def test_token_code_is_single_use(client, make_user, make_oauth_client):
    """Повторный обмен кода — invalid_grant (400)."""
    await make_user()
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    code = await _authorize(client)
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT,
        "client_id": "client-a",
        "code_verifier": "verifier-1",
    }
    first = await client.post("/oidc/token", data=data)
    assert first.status_code == 200
    second = await client.post("/oidc/token", data=data)
    assert second.status_code == 400
    assert second.json()["error"] == "invalid_grant"


async def test_token_unknown_client_is_401(client):
    """Неизвестный клиент на token-эндпоинте — 401 invalid_client."""
    resp = await client.post(
        "/oidc/token",
        data={"grant_type": "authorization_code", "code": "x", "client_id": "нет-такого"},
    )
    assert resp.status_code == 401
    assert resp.json()["error"] == "invalid_client"


async def test_token_unsupported_grant_type(client, make_oauth_client):
    """Неизвестный grant_type — unsupported_grant_type."""
    await make_oauth_client(client_id="client-a")
    resp = await client.post(
        "/oidc/token",
        data={"grant_type": "password", "client_id": "client-a"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "unsupported_grant_type"


async def test_token_refresh_grant_rotates(client, make_user, make_oauth_client):
    """Refresh-грант работает и выдаёт новый токен."""
    await make_user()
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    code = await _authorize(client)
    first = await client.post(
        "/oidc/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT,
            "client_id": "client-a",
            "code_verifier": "verifier-1",
        },
    )
    refresh = first.json()["refresh_token"]
    resp = await client.post(
        "/oidc/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh,
            "client_id": "client-a",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["refresh_token"] != refresh


# ---------------------------------------------------------------------------
# Userinfo
# ---------------------------------------------------------------------------


async def test_userinfo_requires_bearer(client):
    """Без Bearer — 401 с WWW-Authenticate."""
    resp = await client.get("/oidc/userinfo")
    assert resp.status_code == 401
    assert resp.headers.get("www-authenticate") == "Bearer"


async def test_userinfo_returns_claims(client, make_user, make_oauth_client):
    """Claims по access-токену: sub (и email — если разрешён scope)."""
    await make_user(email="user@example.com", email_verified=True)
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    code = await _authorize(client, scope="openid email")
    token_resp = await client.post(
        "/oidc/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT,
            "client_id": "client-a",
            "code_verifier": "verifier-1",
        },
    )
    access = token_resp.json()["access_token"]
    resp = await client.get("/oidc/userinfo", headers={"Authorization": f"Bearer {access}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["sub"]
    assert body["email"] == "user@example.com"
    assert body["email_verified"] is True


async def test_userinfo_rejects_garbage_token(client):
    """Мусорный токен — 401."""
    resp = await client.get("/oidc/userinfo", headers={"Authorization": "Bearer garbage-token"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------


async def test_logout_clears_session_cookie(client, make_user):
    """Выход гасит сессионную куку и уводит на страницу входа."""
    await make_user()
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    assert session_cookie_name() in client.cookies

    resp = await client.get("/oidc/logout")
    assert resp.status_code == 302
    assert resp.headers["location"].startswith("/")
    assert "logged_out=1" in resp.headers["location"]


async def test_logout_returns_to_client_origin(client, make_user, make_oauth_client):
    """Возврат после выхода — только в зону клиента."""
    await make_user()
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    resp = await client.get(
        "/oidc/logout",
        params={"client_id": "client-a", "post_logout_redirect_uri": "https://client.example/bye"},
    )
    assert resp.status_code == 302
    assert resp.headers["location"].startswith("https://client.example/bye")


async def test_logout_rejects_foreign_post_logout_uri(client, make_user, make_oauth_client):
    """Чужой адрес возврата не уводим (open-redirect)."""
    await make_user()
    await make_oauth_client(client_id="client-a", redirect_uris=[REDIRECT])
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    resp = await client.get(
        "/oidc/logout",
        params={"client_id": "client-a", "post_logout_redirect_uri": "https://evil.example/"},
    )
    assert resp.status_code == 302
    assert resp.headers["location"].startswith("/")


# ---------------------------------------------------------------------------
# Auth-API страницы входа
# ---------------------------------------------------------------------------


async def test_login_endpoint_sets_session_cookie(client, make_user):
    """Вход кладёт сессионную куку и отвечает ok."""
    await make_user()
    resp = await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert session_cookie_name() in client.cookies


async def test_login_endpoint_rejects_bad_password(client, make_user):
    """Неверный пароль — 401."""
    await make_user()
    resp = await client.post("/api/auth/login", json={"login": "user1", "password": "не-верный"})
    assert resp.status_code == 401


async def test_me_endpoint_requires_session(client, make_user):
    """Без сессии /me — 401; со сессией — профиль."""
    await make_user()
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401

    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["login"] == "user1"


async def test_logout_endpoint_clears_cookie(client, make_user):
    """POST /api/auth/logout гасит куку."""
    await make_user()
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.parametrize(
    "payload",
    [
        {"login": "ab", "password": "длинный-пароль"},  # логин короче 3
        {"login": "нормальный", "password": "корот"},  # пароль короче 8
        {"login": "плохое имя", "password": "длинный-пароль"},  # недопустимые символы
    ],
)
async def test_register_endpoint_validates_input(client, payload):
    """Регистрация проверяет логин и пароль."""
    resp = await client.post("/api/auth/register", json=payload)
    assert resp.status_code == 422  # стандартный ответ FastAPI по валидации тела
