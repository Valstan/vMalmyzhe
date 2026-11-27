"""Сессия ЕСА: разбор куки → пользователь в ``request.state``.

В Сарафане эту работу делал ``AuthGateMiddleware`` (он же решал, что пускать
без входа, а что нет). В ЕСА гейт нужен только один — «кто вошёл»: сам
сервис и есть точка входа, а доступ к OIDC-эндпоинтам и страницам решает его
собственная логика (см. ``app/routes/oidc.py``).

Правила разбора — те же, что в Сарафане:
- токен проверяется по подписи и сроку;
- ``pf`` (фрагмент хэша пароля) сверяется с актуальным: смена пароля гасит
  все выданные сессии;
- ``iat`` кладётся в ``request.state.session_iat`` — из него берётся
  ``auth_time`` для ID-токена. Cookie без ``iat`` → ``None``, и ``auth_time``
  не заявляется вовсе.
"""

from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .auth import password_fragment, session_cookie_name, verify_session_token

logger = logging.getLogger(__name__)


async def _load_user(uid: int):
    """Пользователь по id (None — если нет или отключён).

    Возвращается сам ORM-объект: он уже загружен и «отсоединён» (сессия с
    ``expire_on_commit=False`` не выбрасывает значения), поэтому маршруты
    могут читать ``user.id``/``user.sub``/``user.role`` как в Сарафане.
    """
    from sqlalchemy import select

    from .db import session_scope
    from .models import RadarUser

    async with session_scope() as session:
        return (
            await session.execute(select(RadarUser).where(RadarUser.id == uid))
        ).scalar_one_or_none()


class SessionMiddleware(BaseHTTPMiddleware):
    """Кладёт в ``request.state`` пользователя сессии (или ``None``)."""

    async def dispatch(self, request: Request, call_next):
        request.state.user = None
        request.state.session_iat = None

        token = request.cookies.get(session_cookie_name())
        if token:
            payload = verify_session_token(token)
            if payload:
                try:
                    uid = int(payload.get("uid", 0))
                except (TypeError, ValueError):
                    uid = 0
                if uid:
                    try:
                        user = await _load_user(uid)
                    except Exception:  # noqa: BLE001 - БД недоступна → не аутентифицирован
                        logger.warning("session: user lookup failed", exc_info=True)
                        user = None
                    if user and user.is_active:
                        # Смена пароля инвалидирует старые сессии: fragment в
                        # токене ≠ актуальному. password_hash nullable (соц-аккаунты
                        # без пароля) — fragment считаем от пустой строки.
                        if payload.get("pf") == password_fragment(user.password_hash or ""):
                            request.state.user = user
                            iat = payload.get("iat")
                            request.state.session_iat = int(iat) if iat else None

        return await call_next(request)
