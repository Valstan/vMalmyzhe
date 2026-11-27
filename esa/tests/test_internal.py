"""Внутренний API ЕСА для портала вмалмыже.рф.

Проверяем три вещи: контракт ответа (идентичность + описание сессии), правила
регистрации (инвайт, занятый логин, логины владельца) и гейт доступа
(loopback + внутренний токен, иначе 404).
"""

from __future__ import annotations

import pytest

from app.auth import verify_session_token

INTERNAL_HEADERS = {"X-ESA-Internal-Token": "test-internal-token"}


# ---------------------------------------------------------------------------
# Вход
# ---------------------------------------------------------------------------


async def test_internal_login_returns_identity_and_session(client, make_user):
    """Успешный вход отдаёт user, session_token и описание cookie."""
    user = await make_user(email="user@example.com", email_verified=True, display_name="Иван")

    resp = await client.post(
        "/internal/auth/login",
        json={"login": "user1", "password": "secret-pass"},
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True

    # Идентичность: ровно тот состав, о котором договорились с порталом.
    assert body["user"] == {
        "sub": user.sub,
        "login": "user1",
        "email": "user@example.com",
        "email_verified": True,
        "display_name": "Иван",
        "role": "radar",
    }

    # Сессия: описание cookie для портала.
    session = body["session"]
    assert session["name"] == "setka_session"
    assert session["path"] == "/"
    assert session["secure"] is True
    assert session["max_age"] == 30 * 24 * 3600
    assert session["value"] == body["session_token"]

    # Значение session.value — РОВНО тот токен, который ЕСА кладёт в куку:
    # его можно разобрать тем же кодом, что и куку.
    payload = verify_session_token(session["value"])
    assert payload is not None
    assert payload["uid"] == user.id
    assert payload["role"] == user.role


async def test_internal_login_value_matches_cookie_token(client, make_user):
    """session.value совпадает с токеном из cookie, выданной обычным входом."""
    await make_user()
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    cookie_token = client.cookies.get("setka_session")
    assert cookie_token

    body = (
        await client.post(
            "/internal/auth/login",
            json={"login": "user1", "password": "secret-pass"},
            headers=INTERNAL_HEADERS,
        )
    ).json()
    assert verify_session_token(body["session"]["value"])["uid"] == verify_session_token(cookie_token)[
        "uid"
    ]


async def test_internal_login_reports_email_verified_flag(client, make_user):
    """Флаг email_verified есть даже когда адреса нет (портал различает «нет» и «не подтверждён»)."""
    await make_user()
    body = (
        await client.post(
            "/internal/auth/login",
            json={"login": "user1", "password": "secret-pass"},
            headers=INTERNAL_HEADERS,
        )
    ).json()
    assert body["user"]["email"] is None
    assert body["user"]["email_verified"] is False


async def test_internal_login_with_wrong_password_is_401(client, make_user):
    """Неверный пароль — 401."""
    await make_user()
    resp = await client.post(
        "/internal/auth/login",
        json={"login": "user1", "password": "не-верный"},
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 401
    assert resp.json()["detail"]


async def test_internal_login_unknown_user_is_401(client):
    """Неизвестный логин — 401 (не «логин занят», чтобы не было enumeration)."""
    resp = await client.post(
        "/internal/auth/login",
        json={"login": "нет-такого", "password": "secret-pass"},
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 401


async def test_internal_login_with_bad_body_is_400(client):
    """Некорректное тело — 400 (контракт внутреннего API)."""
    resp = await client.post(
        "/internal/auth/login",
        json={"login": "u"},  # нет пароля
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Регистрация
# ---------------------------------------------------------------------------


async def test_internal_register_creates_account(client):
    """Регистрация (инвайт не задан) → аккаунт и сессия."""
    resp = await client.post(
        "/internal/auth/register",
        json={"login": "novichok", "password": "длинный-пароль", "email": "n@example.com"},
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["user"]["login"] == "novichok"
    assert body["user"]["email"] == "n@example.com"
    assert body["user"]["email_verified"] is False
    assert verify_session_token(body["session"]["value"]) is not None


async def test_internal_register_duplicate_login_is_409(client, make_user):
    """Занятый логин — 409."""
    await make_user(login="zanyat")
    resp = await client.post(
        "/internal/auth/register",
        json={"login": "ZANYAT", "password": "длинный-пароль"},
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Логин занят"


async def test_internal_register_owner_login_is_409(client):
    """Логины владельца зарезервированы — 409."""
    resp = await client.post(
        "/internal/auth/register",
        json={"login": "VALSTAN", "password": "длинный-пароль"},
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 409


async def test_internal_register_requires_invite_code_when_configured(client, monkeypatch):
    """С заданным ESA_INVITE_CODE регистрация требует кода."""
    monkeypatch.setenv("ESA_INVITE_CODE", "код-из-кармана")
    resp = await client.post(
        "/internal/auth/register",
        json={"login": "novichok", "password": "длинный-пароль"},
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 403

    wrong = await client.post(
        "/internal/auth/register",
        json={"login": "novichok2", "password": "длинный-пароль", "invite_code": "не тот"},
        headers=INTERNAL_HEADERS,
    )
    assert wrong.status_code == 403

    ok = await client.post(
        "/internal/auth/register",
        json={"login": "novichok3", "password": "длинный-пароль", "invite_code": "код-из-кармана"},
        headers=INTERNAL_HEADERS,
    )
    assert ok.status_code == 200


async def test_internal_register_is_open_without_invite_code(client, monkeypatch):
    """Без ESA_INVITE_CODE регистрация открыта."""
    monkeypatch.delenv("ESA_INVITE_CODE", raising=False)
    resp = await client.post(
        "/internal/auth/register",
        json={"login": "novichok", "password": "длинный-пароль"},
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# /internal/auth/me
# ---------------------------------------------------------------------------


async def test_internal_me_with_session_token(client, make_user):
    """Сессионный токен в заголовке X-ESA-Session → профиль."""
    user = await make_user()
    body = (
        await client.post(
            "/internal/auth/login",
            json={"login": "user1", "password": "secret-pass"},
            headers=INTERNAL_HEADERS,
        )
    ).json()
    token = body["session_token"]

    resp = await client.get(
        "/internal/auth/me",
        headers={**INTERNAL_HEADERS, "X-ESA-Session": token},
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["sub"] == user.sub
    assert resp.json()["user"]["login"] == "user1"
    assert resp.json()["user"]["email_verified"] is False


async def test_internal_me_without_session_token_is_401(client):
    """Без заголовка — 401."""
    resp = await client.get("/internal/auth/me", headers=INTERNAL_HEADERS)
    assert resp.status_code == 401


async def test_internal_me_with_forged_session_token_is_401(client):
    """Подделанный токен — 401."""
    resp = await client.get(
        "/internal/auth/me",
        headers={**INTERNAL_HEADERS, "X-ESA-Session": "forged.payload"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Каталог сервисов
# ---------------------------------------------------------------------------


async def test_internal_services_returns_catalog(client):
    """Каталог услуг для меню портала."""
    resp = await client.get("/internal/services", headers=INTERNAL_HEADERS)
    assert resp.status_code == 200
    services = resp.json()["services"]
    assert services
    for item in services:
        assert set(item) == {"title", "emoji", "url", "desc"}


# ---------------------------------------------------------------------------
# Гейт доступа
# ---------------------------------------------------------------------------


async def test_internal_requires_loopback(client_from_outside):
    """Запрос не с loopback — 404 (маршрута для внешнего мира не существует)."""
    resp = await client_from_outside.get("/internal/services", headers=INTERNAL_HEADERS)
    assert resp.status_code == 404


async def test_internal_requires_internal_token(client):
    """Без внутреннего токена — 404."""
    resp = await client.get("/internal/services")
    assert resp.status_code == 404


async def test_internal_rejects_wrong_internal_token(client):
    """С неверным внутренним токеном — 404."""
    resp = await client.get(
        "/internal/services", headers={"X-ESA-Internal-Token": "wrong-token"}
    )
    assert resp.status_code == 404


async def test_internal_is_closed_without_configured_token(client, monkeypatch):
    """Если ESA_INTERNAL_TOKEN не задан — внутренний API закрыт целиком."""
    monkeypatch.delenv("ESA_INTERNAL_TOKEN", raising=False)
    resp = await client.get("/internal/services", headers=INTERNAL_HEADERS)
    assert resp.status_code == 404


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/internal/auth/me"),
        ("get", "/internal/services"),
    ],
)
async def test_internal_paths_are_404_from_outside(client_from_outside, method, path):
    """Все маршруты /internal закрыты снаружи одинаково."""
    resp = await getattr(client_from_outside, method)(path, headers=INTERNAL_HEADERS)
    assert resp.status_code == 404
