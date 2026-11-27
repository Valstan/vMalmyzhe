"""Внутренний API ЕСА для портала вмалмыже.рф.

Этого API в Сарафане не было — там портал был отдельным приложением. Смысл:
портал (Next.js) сам НЕ хранит пароли и не умеет проверять их, поэтому вход и
регистрация делаются в ЕСА, а портал получает готовый сессионный токен и
кладёт его в браузер как куку ЕСА. Так вход общий для всей зоны
``.вмалмыже.рф`` (в том числе для ВК-входа: cookie одна на домен).

Маршруты:
- ``POST /internal/auth/login``    — {login, password} → {ok, user, session_token, session};
- ``POST /internal/auth/register`` — {login, password, email?, invite_code?} → то же;
- ``GET  /internal/auth/me``       — заголовок ``X-ESA-Session`` → {user};
- ``GET  /internal/services``      — каталог сервисов (для меню портала).

Доступ — ТОЛЬКО с loopback (127.0.0.1 / ::1) И заголовок
``X-ESA-Internal-Token``, равный ``ESA_INTERNAL_TOKEN``. Иначе — 404, а не 403:
для внешнего мира такого маршрута просто не существует.

⚠️ nginx не должен проксировать ``/internal/*`` из интернета (см. README).
"""

from __future__ import annotations

import hmac
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from ..accounts import AccountError, find_user_by_login, register_user
from ..auth import (
    SESSION_TTL_SECONDS,
    issue_session_token,
    password_fragment,
    session_cookie_name,
    verify_password,
    verify_session_token,
)
from ..clock import utcnow
from ..config import (
    get_internal_token,
    get_session_cookie_domain,
    get_session_cookie_secure,
)
from ..db import session_scope
from ..services_catalog import get_services

logger = logging.getLogger(__name__)
_audit = logging.getLogger("esa.audit")

router = APIRouter()

# Разрешённые источники: только loopback.
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1"})

# Имя заголовка с сессионным токеном (портал шлёт его обратно в /me).
SESSION_HEADER = "X-ESA-Session"

# Имя заголовка внутреннего токена.
INTERNAL_TOKEN_HEADER = "X-ESA-Internal-Token"


class InternalLoginIn(BaseModel):
    login: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)


class InternalRegisterIn(BaseModel):
    login: str = Field(..., min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(..., min_length=8, max_length=256)
    email: Optional[str] = Field(None, max_length=255)
    invite_code: Optional[str] = Field(None, max_length=128)


# ---------------------------------------------------------------------------
# Гейт доступа
# ---------------------------------------------------------------------------


def _not_found() -> HTTPException:
    """Единая отказка: маршрута для внешнего мира не существует."""
    return HTTPException(status_code=404, detail="Not Found")


def require_internal_access(request: Request) -> None:
    """Пропустить только loopback + верный внутренний токен.

    Обе проверки обязательны: токен — главный рубеж (nginx проксирует с
    localhost, поэтому сам по себе loopback ничего не значит), loopback —
    вторая линия обороны.
    """
    expected = get_internal_token()
    if not expected:
        logger.warning("esa: ESA_INTERNAL_TOKEN is not set — internal API is closed")
        raise _not_found()
    host = request.client.host if request.client else ""
    if host not in LOOPBACK_HOSTS:
        raise _not_found()
    provided = request.headers.get(INTERNAL_TOKEN_HEADER) or ""
    if not hmac.compare_digest(provided, expected):
        raise _not_found()


# ---------------------------------------------------------------------------
# Помощники ответа
# ---------------------------------------------------------------------------


def _session_payload(user) -> Dict[str, Any]:
    """Описание сессионной cookie ЕСА — портал ставит её как есть."""
    token = issue_session_token(user.id, user.role, password_fragment(user.password_hash or ""))
    return {
        "name": session_cookie_name(),
        "value": token,
        "domain": get_session_cookie_domain(),
        "path": "/",
        "secure": get_session_cookie_secure(),
        "max_age": SESSION_TTL_SECONDS,
    }


def _auth_response(user) -> Dict[str, Any]:
    """Единый ответ на успешный вход/регистрацию."""
    session = _session_payload(user)
    return {
        "ok": True,
        "user": user.identity_dict(),
        "session_token": session["value"],
        "session": session,
    }


# ---------------------------------------------------------------------------
# Маршруты
# ---------------------------------------------------------------------------


@router.post("/auth/login")
async def internal_login(request: Request, body: InternalLoginIn):
    """Вход по логину/паролю → идентичность + сессионный токен ЕСА."""
    require_internal_access(request)
    async with session_scope() as session:
        user = await find_user_by_login(session, body.login)
        ok = bool(user) and verify_password(body.password, user.password_hash or "")
        if not ok or not user.is_active:
            raise HTTPException(status_code=401, detail="Неверный логин или пароль")
        user.last_login_at = utcnow()
        await session.commit()
        payload = _auth_response(user)
    _audit.info("internal: login ok login=%s sub=%s", user.login, user.sub)
    return payload


@router.post("/auth/register")
async def internal_register(request: Request, body: InternalRegisterIn):
    """Регистрация аккаунта ЕСА → идентичность + сессионный токен."""
    require_internal_access(request)
    try:
        async with session_scope() as session:
            user = await register_user(
                session,
                login=body.login,
                password=body.password,
                email=body.email,
                invite_code=body.invite_code,
            )
            payload = _auth_response(user)
    except AccountError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    _audit.info("internal: register ok login=%s sub=%s", user.login, user.sub)
    return payload


@router.get("/auth/me")
async def internal_me(
    request: Request,
    x_esa_session: Optional[str] = Header(None, alias=SESSION_HEADER),
):
    """Кто вошёл — по сессионному токену ЕСА."""
    require_internal_access(request)
    if not x_esa_session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = verify_session_token(x_esa_session)
    if not payload:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        uid = int(payload.get("uid", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Not authenticated")
    async with session_scope() as session:
        from sqlalchemy import select

        from ..models import RadarUser

        user = (
            await session.execute(select(RadarUser).where(RadarUser.id == uid))
        ).scalar_one_or_none()
        if user is None or not user.is_active:
            raise HTTPException(status_code=401, detail="Not authenticated")
        # Смена пароля гасит старые сессии (фрагмент хэша в токене).
        if payload.get("pf") != password_fragment(user.password_hash or ""):
            raise HTTPException(status_code=401, detail="Not authenticated")
        identity = user.identity_dict()
    return {"user": identity}


@router.get("/services")
async def internal_services(request: Request):
    """Каталог сервисов экосистемы (для меню портала)."""
    require_internal_access(request)
    return {"services": get_services()}
