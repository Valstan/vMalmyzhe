"""Пароли, сессионные токены, резервирование логинов.

Формат хэша пароля и формат токена сессии — НАСЛЕДУЕМЫЕ от Сарафана: от них
зависят уже выданные клиентам секреты и живые сессии. Тесты фиксируют формат,
чтобы случайная смена не прошла молча.
"""

from __future__ import annotations

import time

import pytest

from app.accounts import (
    AccountError,
    InviteInvalid,
    InviteRequired,
    LoginTaken,
    check_invite,
    is_reserved_login,
    normalize_login,
    register_user,
)
from app.auth import (
    hash_password,
    issue_reauth_marker,
    issue_session_token,
    password_fragment,
    read_reauth_marker,
    verify_password,
    verify_session_token,
)


# ---------------------------------------------------------------------------
# Пароли
# ---------------------------------------------------------------------------


def test_password_hash_round_trip():
    """Хэш проверяет верный пароль и отвергает неверный."""
    stored = hash_password("правильный-пароль")
    assert verify_password("правильный-пароль", stored) is True
    assert verify_password("неправильный", stored) is False


def test_password_hash_format_is_inherited():
    """Формат хэша прежний: scrypt$n$r$p$salt$hash (старые хэши должны читаться)."""
    stored = hash_password("пароль")
    algo, n, r, p, salt_b64, hash_b64 = stored.split("$")
    assert algo == "scrypt"
    assert (int(n), int(r), int(p)) == (2**14, 8, 1)
    assert salt_b64 and hash_b64


def test_verify_password_rejects_garbage():
    """Любой мусор в хранимом хэше → False, а не исключение."""
    assert verify_password("пароль", "") is False
    assert verify_password("пароль", "не-хэш") is False
    assert verify_password("пароль", "scrypt$1$2$3$4$5") is False
    assert verify_password("пароль", "bcrypt$16384$8$1$c2FsdA$aGFzaA") is False


def test_password_hashes_are_salted():
    """Два одинаковых пароля дают разные хэши (соль случайна)."""
    assert hash_password("пароль") != hash_password("пароль")


def test_password_fragment_is_stable_and_short():
    """Фрагмент хэша стабилен и короткий (он едет в токен сессии)."""
    stored = hash_password("пароль")
    assert password_fragment(stored) == password_fragment(stored)
    assert len(password_fragment(stored)) == 12


# ---------------------------------------------------------------------------
# Сессионный токен
# ---------------------------------------------------------------------------


def test_session_token_round_trip():
    """Токен разбирается обратно в payload."""
    token = issue_session_token(42, "radar", "frag123")
    payload = verify_session_token(token)
    assert payload is not None
    assert payload["uid"] == 42
    assert payload["role"] == "radar"
    assert payload["pf"] == "frag123"
    assert payload["iat"] <= int(time.time())
    assert payload["exp"] > payload["iat"]


def test_session_token_format_is_inherited():
    """Формат прежний: b64url(payload).b64url(hmac) — две части через точку."""
    token = issue_session_token(1, "radar", "f")
    body, sig = token.split(".")
    assert body and sig
    assert "=" not in token


def test_forged_session_token_is_rejected():
    """Подделка подписи и подмена payload не проходят."""
    token = issue_session_token(42, "radar", "frag123")
    body, sig = token.split(".")

    # Подмена payload при прежней подписи.
    forged_body = body[:-2] + ("AB" if not body.endswith("AB") else "CD")
    assert verify_session_token(f"{forged_body}.{sig}") is None

    # Подмена подписи.
    assert verify_session_token(f"{body}.{'A' * len(sig)}") is None

    # Чужой секрет — другой HMAC.
    import app.auth as auth_module

    original = auth_module._secret
    try:
        auth_module._secret = lambda: b"other-secret"
        assert verify_session_token(token) is None
    finally:
        auth_module._secret = original


def test_expired_session_token_is_rejected():
    """Просроченный токен не принимается."""
    token = issue_session_token(42, "radar", "frag123", ttl_seconds=1, _now=time.time() - 10)
    assert verify_session_token(token) is None


def test_broken_session_token_is_rejected():
    """Мусор в токене → None, а не исключение."""
    assert verify_session_token("") is None
    assert verify_session_token("нет-точки") is None
    assert verify_session_token("a.b.c") is None


# ---------------------------------------------------------------------------
# Метка переспроса входа (prompt=login)
# ---------------------------------------------------------------------------


def test_reauth_marker_round_trip():
    """Метка разбирается и не протухает сразу."""
    marker = issue_reauth_marker()
    ts = read_reauth_marker(marker)
    assert ts is not None
    assert abs(ts - time.time()) < 5


def test_forged_reauth_marker_is_rejected():
    """Подпись метки проверяется."""
    marker = issue_reauth_marker()
    ts_raw, sig = marker.split(".")
    assert read_reauth_marker(f"{ts_raw}.{'A' * len(sig)}") is None
    assert read_reauth_marker("") is None
    assert read_reauth_marker(None) is None


def test_expired_reauth_marker_is_rejected():
    """Протухшая метка не засчитывается как «только что вошёл»."""
    marker = issue_reauth_marker(_now=time.time() - 3600)
    assert read_reauth_marker(marker) is None


# ---------------------------------------------------------------------------
# Логины: нормализация, резерв владельца, уникальность
# ---------------------------------------------------------------------------


def test_login_is_normalized():
    """Логин нормализуется: trim + нижний регистр."""
    assert normalize_login("  VALSTAN  ") == "valstan"


def test_owner_logins_are_reserved():
    """Логины владельца зарезервированы в любом регистре."""
    assert is_reserved_login("valstan") is True
    assert is_reserved_login("VALSTAN") is True
    assert is_reserved_login(" Valstan ") is True
    assert is_reserved_login("someone-else") is False


async def test_register_rejects_reserved_owner_login(session):
    """Аккаунт с логином владельца не заводится."""
    with pytest.raises(LoginTaken):
        await register_user(session, login="VALSTAN", password="длинный-пароль")


async def test_login_uniqueness_is_case_insensitive(session):
    """Логины уникальны регистронезависимо (иначе «USER» жил бы рядом с «user»)."""
    await register_user(session, login="User1", password="длинный-пароль")
    with pytest.raises(LoginTaken):
        await register_user(session, login="user1", password="длинный-пароль")


async def test_registered_user_gets_sub_and_role(session):
    """Новый аккаунт получает sub (OIDC) и роль radar (без эскалации)."""
    user = await register_user(session, login="novichok", password="длинный-пароль")
    assert user.sub
    assert user.role == "radar"
    assert user.is_active is True
    assert user.email_verified is False


# ---------------------------------------------------------------------------
# Инвайт-регистрация
# ---------------------------------------------------------------------------


def test_registration_is_open_without_invite_code(monkeypatch):
    """Без ESA_INVITE_CODE регистрация открыта."""
    monkeypatch.delenv("ESA_INVITE_CODE", raising=False)
    check_invite(None)  # не бросает


def test_registration_requires_invite_code_when_configured(monkeypatch):
    """С заданным ESA_INVITE_CODE код обязателен."""
    monkeypatch.setenv("ESA_INVITE_CODE", "секретный-код")
    with pytest.raises(InviteRequired):
        check_invite(None)
    with pytest.raises(InviteInvalid):
        check_invite("неправильный")
    check_invite("секретный-код")  # совпал — ок


def test_old_radar_invite_code_is_not_used(monkeypatch):
    """Старый RADAR_INVITE_CODE в новом сервисе не действует."""
    monkeypatch.delenv("ESA_INVITE_CODE", raising=False)
    monkeypatch.setenv("RADAR_INVITE_CODE", "старый-код")
    check_invite(None)  # регистрация открыта — старый код ничего не значит


def test_account_error_carries_status():
    """У ошибок аккаунта есть HTTP-статус (403/409/400)."""
    assert InviteRequired.status_code == 403
    assert InviteInvalid.status_code == 403
    assert LoginTaken.status_code == 409
    assert AccountError.status_code == 400
