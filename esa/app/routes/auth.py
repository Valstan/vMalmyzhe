"""Публичный auth-API ЕСА: вход, выход, «кто я», регистрация.

Сессия — stateless signed-cookie (``app/auth.py``), разбор куки — middleware
``app/session.py``. Здесь только выдача/гашение cookie и регистрация
аккаунтов.

Отличие от Сарафана: правило инвайта новое (см. ``app/accounts.py``) — если
``ESA_INVITE_CODE`` не задан, регистрация открыта; старый ``RADAR_INVITE_CODE``
больше не используется.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..accounts import (
    AccountError,
    LoginTaken,
    check_invite,
    find_user_by_login,
    register_user,
)
from ..auth import (
    SESSION_TTL_SECONDS,
    issue_session_token,
    password_fragment,
    session_cookie_name,
    verify_password,
)
from ..clock import utcnow
from ..config import get_session_cookie_domain, get_session_cookie_secure
from ..db import session_scope

logger = logging.getLogger(__name__)
router = APIRouter()


class LoginIn(BaseModel):
    login: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)


class RegisterIn(BaseModel):
    login: str = Field(..., min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(..., min_length=8, max_length=256)
    email: Optional[str] = Field(None, max_length=255)
    invite_code: Optional[str] = Field(None, max_length=128)


def cookie_domain() -> str | None:
    """Домен сессионной куки (общий вход на всю зону) или None (host-only)."""
    return get_session_cookie_domain()


def set_session_cookie(response: Response, user) -> None:
    """Выдать сессионную куку ЕСА."""
    # password_hash nullable (соц-only аккаунты) — fragment от "".
    token = issue_session_token(user.id, user.role, password_fragment(user.password_hash or ""))
    response.set_cookie(
        session_cookie_name(),
        token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        # На проде cookie ходит только по HTTPS; локальный dev (http) выключает env'ом.
        secure=get_session_cookie_secure(),
        domain=cookie_domain(),
    )


def delete_session_cookie(response: Response) -> None:
    """Погасить сессионную куку."""
    response.delete_cookie(session_cookie_name(), domain=cookie_domain())


@router.post("/login")
async def login(body: LoginIn, response: Response):
    """Проверить креды и выдать сессионную cookie."""
    async with session_scope() as session:
        user = await find_user_by_login(session, body.login)
        # verify и на несуществующем юзере (фиктивный хэш не храним — просто
        # ровняем стоимость ответа, не выдавая enumeration по таймингу scrypt).
        # or "": соц-only аккаунт без пароля не роняет verify (честный 401).
        ok = bool(user) and verify_password(body.password, user.password_hash or "")
        if not ok or not user.is_active:
            raise HTTPException(status_code=401, detail="Неверный логин или пароль")
        user.last_login_at = utcnow()
        await session.commit()
        set_session_cookie(response, user)
        return {"ok": True, "role": user.role, "login": user.login}


@router.post("/logout")
async def logout(response: Response):
    """Погасить сессию (удалить cookie; токен stateless — сам истечёт)."""
    delete_session_cookie(response)
    return {"ok": True}


@router.get("/me")
async def me(request: Request):
    """Текущий пользователь (middleware уже положил его в request.state)."""
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user.to_dict()


@router.post("/register")
async def register(body: RegisterIn, response: Response):
    """Регистрация аккаунта ЕСА (инвайт-код — если задан ``ESA_INVITE_CODE``)."""
    try:
        check_invite(body.invite_code)
        async with session_scope() as session:
            user = await register_user(
                session,
                login=body.login,
                password=body.password,
                email=body.email,
                invite_code=body.invite_code,
            )
            set_session_cookie(response, user)
    except AccountError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return {"ok": True, "role": user.role, "login": user.login}


__all__ = [
    "LoginIn",
    "LoginTaken",
    "RegisterIn",
    "cookie_domain",
    "delete_session_cookie",
    "router",
    "set_session_cookie",
]
