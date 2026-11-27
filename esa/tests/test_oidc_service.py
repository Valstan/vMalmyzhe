"""Ядро OIDC: коды, PKCE, scope, refresh-ротация, prompt/max_age.

Тесты бьют по сервисному слою (``app.oidc.service``) — без HTTP: так видно
сами правила протокола, а не их обвязку.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from authlib.jose import jwt
from authlib.oauth2.rfc7636 import create_s256_code_challenge

from app.clock import utcnow
from app.oidc import service
from app.oidc.service import OidcError

REDIRECT = "https://client.example/cb"


async def _issue(session, user, client, **kwargs) -> str:
    """Выдать код с дефолтами (PKCE S256)."""
    params = {
        "client": client,
        "user": user,
        "redirect_uri": REDIRECT,
        "scope": "openid profile",
        "code_challenge": create_s256_code_challenge("verifier-1"),
        "code_challenge_method": "S256",
        "nonce": None,
    }
    params.update(kwargs)
    return await service.issue_auth_code(session, **params)


# ---------------------------------------------------------------------------
# PKCE
# ---------------------------------------------------------------------------


async def test_public_client_requires_pkce(session, make_user, make_oauth_client):
    """Public-клиент без PKCE — отказ (MUST)."""
    user = await make_user()
    client = await make_oauth_client(is_confidential=False)
    with pytest.raises(OidcError) as exc:
        await _issue(session, user, client, code_challenge=None)
    assert exc.value.error == "invalid_request"
    assert "PKCE" in exc.value.description


async def test_public_client_rejects_non_s256(session, make_user, make_oauth_client):
    """Public-клиент с не-S256 challenge — отказ."""
    user = await make_user()
    client = await make_oauth_client(is_confidential=False)
    with pytest.raises(OidcError) as exc:
        await _issue(session, user, client, code_challenge_method="plain")
    assert exc.value.error == "invalid_request"
    assert "S256" in exc.value.description


async def test_confidential_client_may_omit_pkce(session, make_user, make_oauth_client):
    """Confidential-клиент может обойтись без PKCE."""
    user = await make_user()
    client = await make_oauth_client(is_confidential=True, client_secret="s3cret")
    raw = await _issue(session, user, client, code_challenge=None)
    assert raw


# ---------------------------------------------------------------------------
# Authorization code: одноразовость и TTL
# ---------------------------------------------------------------------------


async def test_code_is_single_use(session, make_user, make_oauth_client):
    """Повторный обмен кода — invalid_grant."""
    user = await make_user()
    client = await make_oauth_client(is_confidential=False)
    raw = await _issue(session, user, client)
    bundle = await service.exchange_code(
        session,
        client=client,
        raw_code=raw,
        redirect_uri=REDIRECT,
        code_verifier="verifier-1",
    )
    assert bundle.access_token
    with pytest.raises(OidcError) as exc:
        await service.exchange_code(
            session,
            client=client,
            raw_code=raw,
            redirect_uri=REDIRECT,
            code_verifier="verifier-1",
        )
    assert exc.value.error == "invalid_grant"


async def test_code_has_ttl(session, make_user, make_oauth_client, monkeypatch):
    """Код протухает: TTL задаётся конфигом, просроченный код не обменивается."""
    monkeypatch.setenv("ESA_AUTH_CODE_TTL", "0")
    user = await make_user()
    client = await make_oauth_client(is_confidential=False)
    raw = await _issue(session, user, client)
    with pytest.raises(OidcError) as exc:
        await service.exchange_code(
            session,
            client=client,
            raw_code=raw,
            redirect_uri=REDIRECT,
            code_verifier="verifier-1",
        )
    assert exc.value.error == "invalid_grant"
    assert "expired" in exc.value.description


async def test_code_ttl_default_is_60_seconds():
    """Канонический TTL кода — 60 секунд (если не переопределён env'ом)."""
    from app.config import get_auth_code_ttl

    assert get_auth_code_ttl() == 60


# ---------------------------------------------------------------------------
# redirect_uri
# ---------------------------------------------------------------------------


async def test_redirect_uri_matched_exactly(session, make_user, make_oauth_client):
    """Символ в символ: лишний слэш — уже другой uri."""
    await make_user()
    client = await make_oauth_client(
        is_confidential=False, redirect_uris=["https://client.example/cb"]
    )
    service.validate_redirect_uri(client, "https://client.example/cb")
    with pytest.raises(OidcError):
        service.validate_redirect_uri(client, "https://client.example/cb/")
    with pytest.raises(OidcError):
        service.validate_redirect_uri(client, "https://client.example/cb?x=1")


async def test_unknown_redirect_uri_rejected(session, make_user, make_oauth_client):
    """Незарегистрированный uri — invalid_request."""
    await make_user()
    client = await make_oauth_client(is_confidential=False)
    with pytest.raises(OidcError) as exc:
        service.validate_redirect_uri(client, "https://evil.example/steal")
    assert exc.value.error == "invalid_request"


async def test_exchange_rejects_mismatched_redirect_uri(session, make_user, make_oauth_client):
    """На обмене uri сверяется с тем, что был при выдаче кода."""
    user = await make_user()
    client = await make_oauth_client(is_confidential=False)
    raw = await _issue(session, user, client)
    with pytest.raises(OidcError) as exc:
        await service.exchange_code(
            session,
            client=client,
            raw_code=raw,
            redirect_uri="https://client.example/other",
            code_verifier="verifier-1",
        )
    assert exc.value.error == "invalid_grant"
    assert "redirect_uri" in exc.value.description


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------


async def test_scope_requires_openid(session, make_oauth_client):
    """Без openid — invalid_scope."""
    client = await make_oauth_client()
    with pytest.raises(OidcError) as exc:
        service.resolve_scope(client, "profile email")
    assert exc.value.error == "invalid_scope"


async def test_scope_intersects_with_allowed(session, make_oauth_client):
    """Выдаётся только пересечение requested ∩ allowed."""
    client = await make_oauth_client(allowed_scopes="openid profile")
    assert service.resolve_scope(client, "openid profile email") == "openid profile"


async def test_scope_order_is_canonical(session, make_oauth_client):
    """Порядок скоупов канонический (по SUPPORTED_SCOPES) — детерминизм."""
    client = await make_oauth_client(allowed_scopes="openid email profile")
    assert service.resolve_scope(client, "profile email openid") == "openid profile email"


async def test_scope_not_allowed_for_client(session, make_oauth_client):
    """Клиент без openid в своём потолке — invalid_scope."""
    client = await make_oauth_client(allowed_scopes="profile")
    with pytest.raises(OidcError) as exc:
        service.resolve_scope(client, "openid")
    assert exc.value.error == "invalid_scope"


# ---------------------------------------------------------------------------
# Refresh: ротация и reuse-detection
# ---------------------------------------------------------------------------


async def test_refresh_rotates_token(session, make_user, make_oauth_client):
    """Обмен refresh-токена выдаёт новый и гасит старый."""
    user = await make_user()
    client = await make_oauth_client(is_confidential=False)
    raw = await _issue(session, user, client)
    bundle = await service.exchange_code(
        session,
        client=client,
        raw_code=raw,
        redirect_uri=REDIRECT,
        code_verifier="verifier-1",
    )
    rotated = await service.refresh_grant(
        session, client=client, raw_refresh=bundle.refresh_token
    )
    assert rotated.refresh_token != bundle.refresh_token
    assert rotated.access_token


async def test_refresh_reuse_revokes_whole_family(session, make_user, make_oauth_client):
    """Повторное предъявление погашенного токена отзывает всю family."""
    user = await make_user()
    client = await make_oauth_client(is_confidential=False)
    raw = await _issue(session, user, client)
    bundle = await service.exchange_code(
        session,
        client=client,
        raw_code=raw,
        redirect_uri=REDIRECT,
        code_verifier="verifier-1",
    )
    rotated = await service.refresh_grant(
        session, client=client, raw_refresh=bundle.refresh_token
    )
    # Повторно предъявляем погашенный токен — признак компрометации.
    with pytest.raises(OidcError) as exc:
        await service.refresh_grant(session, client=client, raw_refresh=bundle.refresh_token)
    assert exc.value.error == "invalid_grant"
    assert "reuse" in exc.value.description
    # Вся family погашена — новый токен тоже больше не работает.
    with pytest.raises(OidcError) as exc2:
        await service.refresh_grant(session, client=client, raw_refresh=rotated.refresh_token)
    assert exc2.value.error == "invalid_grant"


async def test_refresh_keeps_auth_time(session, make_user, make_oauth_client):
    """auth_time едет по цепочке ротаций неизменным."""
    user = await make_user()
    client = await make_oauth_client(is_confidential=False)
    auth_time = utcnow() - timedelta(minutes=5)
    raw = await _issue(session, user, client, auth_time=auth_time)
    bundle = await service.exchange_code(
        session,
        client=client,
        raw_code=raw,
        redirect_uri=REDIRECT,
        code_verifier="verifier-1",
    )
    rotated = await service.refresh_grant(
        session, client=client, raw_refresh=bundle.refresh_token
    )
    claims = jwt.decode(rotated.id_token, service.get_public_jwks())
    assert claims["auth_time"] == int(auth_time.timestamp())


# ---------------------------------------------------------------------------
# auth_time
# ---------------------------------------------------------------------------


async def test_id_token_has_no_auth_time_when_unknown(session, make_user, make_oauth_client):
    """Неизвестное время входа → claim не заявляется (а не подставляется «сейчас»)."""
    user = await make_user()
    client = await make_oauth_client(is_confidential=False)
    raw = await _issue(session, user, client, auth_time=None)
    bundle = await service.exchange_code(
        session,
        client=client,
        raw_code=raw,
        redirect_uri=REDIRECT,
        code_verifier="verifier-1",
    )
    claims = jwt.decode(bundle.id_token, service.get_public_jwks())
    assert "auth_time" not in claims


async def test_id_token_has_auth_time_when_known(session, make_user, make_oauth_client):
    """Известное время входа → claim есть."""
    user = await make_user()
    client = await make_oauth_client(is_confidential=False)
    auth_time = utcnow() - timedelta(minutes=2)
    raw = await _issue(session, user, client, auth_time=auth_time)
    bundle = await service.exchange_code(
        session,
        client=client,
        raw_code=raw,
        redirect_uri=REDIRECT,
        code_verifier="verifier-1",
    )
    claims = jwt.decode(bundle.id_token, service.get_public_jwks())
    assert claims["auth_time"] == int(auth_time.timestamp())


# ---------------------------------------------------------------------------
# prompt / max_age / свежесть входа
# ---------------------------------------------------------------------------


def test_parse_prompt_none_with_other_is_invalid():
    """prompt=none вместе с чем-то ещё — invalid_request."""
    with pytest.raises(OidcError) as exc:
        service.parse_prompt("none login")
    assert exc.value.error == "invalid_request"


def test_parse_prompt_consent_is_refused():
    """Consent-экрана нет — честный отказ consent_required."""
    with pytest.raises(OidcError) as exc:
        service.parse_prompt("consent")
    assert exc.value.error == "consent_required"


def test_parse_prompt_unknown_value_is_invalid():
    """Неизвестный prompt нельзя молча съесть."""
    with pytest.raises(OidcError) as exc:
        service.parse_prompt("magic")
    assert exc.value.error == "invalid_request"


def test_parse_prompt_none_and_login_are_accepted():
    """none и login — поддерживаемые значения."""
    assert service.parse_prompt("none") == frozenset({"none"})
    assert service.parse_prompt("login") == frozenset({"login"})


def test_parse_max_age_rejects_negative_and_garbage():
    """max_age — неотрицательное целое."""
    with pytest.raises(OidcError):
        service.parse_max_age("-1")
    with pytest.raises(OidcError):
        service.parse_max_age("soon")
    assert service.parse_max_age("60") == 60
    assert service.parse_max_age(None) is None


def test_needs_reauth_when_auth_time_unknown():
    """Без известного времени входа требование свежести не выполнено."""
    assert service.needs_reauth(prompt=frozenset(), max_age=60, auth_time=None) is True


def test_needs_reauth_respects_max_age():
    """Свежий вход внутри max_age — переспрос не нужен."""
    now = utcnow()
    assert (
        service.needs_reauth(
            prompt=frozenset(),
            max_age=3600,
            auth_time=now - timedelta(seconds=10),
            now=now,
        )
        is False
    )
    assert (
        service.needs_reauth(
            prompt=frozenset(),
            max_age=60,
            auth_time=now - timedelta(seconds=600),
            now=now,
        )
        is True
    )


def test_needs_reauth_prompt_login_requires_new_login():
    """prompt=login требует входа ЗАНОВО (точка отсчёта — reauth_since)."""
    now = utcnow()
    old = now - timedelta(minutes=10)
    # Метка «переспросить» ПОЗЖЕ входа → вход старый, требование не выполнено.
    assert (
        service.needs_reauth(
            prompt=frozenset({"login"}),
            max_age=None,
            auth_time=old,
            now=now,
            reauth_since=old + timedelta(minutes=1),
        )
        is True
    )
    # Вход ПОСЛЕ метки → человек вошёл заново, требование выполнено.
    assert (
        service.needs_reauth(
            prompt=frozenset({"login"}),
            max_age=None,
            auth_time=now - timedelta(seconds=5),
            now=now,
            reauth_since=old,
        )
        is False
    )


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def test_discovery_document_has_canonical_endpoints():
    """Discovery объявляет канонические пути и честный набор prompt'ов."""
    doc = service.discovery_document()
    assert doc["issuer"].startswith("https://")
    assert doc["authorization_endpoint"].endswith("/oidc/authorize")
    assert doc["token_endpoint"].endswith("/oidc/token")
    assert doc["userinfo_endpoint"].endswith("/oidc/userinfo")
    assert doc["end_session_endpoint"].endswith("/oidc/logout")
    assert doc["jwks_uri"].endswith("/.well-known/jwks.json")
    assert doc["code_challenge_methods_supported"] == ["S256"]
    assert doc["id_token_signing_alg_values_supported"] == ["RS256"]
    assert "consent" not in doc["prompt_values_supported"]
    assert doc["response_types_supported"] == ["code"]
