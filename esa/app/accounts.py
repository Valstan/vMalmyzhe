"""Аккаунты ЕСА: общие правила входа и регистрации.

Правила одинаковы для публичного ``/api/auth/register`` и для внутреннего
``/internal/auth/register`` — иначе один и тот же человек заводил бы себя
двумя разными путями с разными правилами.

Инвайт-регистрация (правило владельца, 2026-11-27):
- ``ESA_INVITE_CODE`` задан и непустой → регистрация требует поле
  ``invite_code`` и его совпадения (сравнение ``hmac.compare_digest``);
- ``ESA_INVITE_CODE`` не задан → регистрация открыта.

Старый ``RADAR_INVITE_CODE`` здесь НЕ используется.

Логины владельца зарезервированы: завести аккаунт с таким логином нельзя
(владелец опознаётся по логину, а уникальность логина в БД регистрозависима —
иначе «VALSTAN» завёлся бы рядом с «valstan»).
"""

from __future__ import annotations

import hmac
import logging
from typing import Optional

from sqlalchemy import select

from .config import get_invite_code, get_owner_logins
from .models import RadarUser

logger = logging.getLogger(__name__)


class AccountError(Exception):
    """Базовая ошибка операции с аккаунтом."""

    status_code = 400


class InviteRequired(AccountError):
    """Регистрация закрыта инвайт-кодом, а код не пришёл."""

    status_code = 403


class InviteInvalid(AccountError):
    """Инвайт-код не совпал."""

    status_code = 403


class LoginTaken(AccountError):
    """Логин уже занят (включая зарезервированные логины владельца)."""

    status_code = 409


class AccountInactive(AccountError):
    """Аккаунт отключён."""

    status_code = 403


def normalize_login(login: str) -> str:
    """Нормализованный логин (trim + нижний регистр) — ключ уникальности."""
    return (login or "").strip().lower()


def is_reserved_login(login: str) -> bool:
    """Логин зарезервирован за владельцем?"""
    return normalize_login(login) in get_owner_logins()


def check_invite(invite_code: Optional[str]) -> None:
    """Проверить инвайт-код по правилу выше (нет кода в env — регистрация открыта).

    Сравнение — ``hmac.compare_digest`` по БАЙТАМ: ``compare_digest`` для
    строк принимает только ASCII, а код владельца может быть любым — с
    не-ASCII сравнение строк бросило бы исключение (500 вместо 403).
    """
    expected = get_invite_code()
    if not expected:
        return
    if not invite_code:
        raise InviteRequired("Регистрация по инвайт-коду")
    if not hmac.compare_digest(invite_code.encode("utf-8"), expected.encode("utf-8")):
        raise InviteInvalid("Неверный инвайт-код")


async def find_user_by_login(session, login: str) -> Optional[RadarUser]:
    """Аккаунт по нормализованному логину (None — не найден)."""
    normalized = normalize_login(login)
    if not normalized:
        return None
    return (
        await session.execute(select(RadarUser).where(RadarUser.login == normalized))
    ).scalar_one_or_none()


async def register_user(
    session,
    *,
    login: str,
    password: str,
    email: Optional[str] = None,
    invite_code: Optional[str] = None,
    display_name: Optional[str] = None,
) -> RadarUser:
    """Создать аккаунт ЕСА.

    Порядок проверок — тот же, что в Сарафане: сначала инвайт, потом занятость
    логина, потом запись. Логины владельца считаются занятыми всегда.
    """
    from .auth import hash_password

    check_invite(invite_code)

    normalized = normalize_login(login)
    if not normalized:
        raise AccountError("Логин не указан")
    if is_reserved_login(normalized):
        logger.warning("Register attempt on reserved owner login: %s", normalized)
        raise LoginTaken("Логин занят")

    if await find_user_by_login(session, normalized) is not None:
        raise LoginTaken("Логин занят")

    user = RadarUser(
        login=normalized,
        password_hash=hash_password(password),
        role="radar",
        is_active=True,
        email=(email or None),
        email_verified=False,  # адрес из формы не подтверждён — портал его не покажет
        display_name=display_name or None,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    logger.info("Account registered: %s", user.login)
    return user
