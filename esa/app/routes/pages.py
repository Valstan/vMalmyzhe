"""Публичные страницы ЕСА: вход и каталог сервисов.

- ``GET /``       — страница входа (login.html);
- ``GET /login``  — тот же адрес (совместимость: клиенты экосистемы строят
  ``{issuer}/login?next=...``, как это делал AuthGate Сарафана);
- ``GET /services`` — каталог сервисов (services.html).

Страница входа понимает, ОТКУДА пришёл посетитель (OIDC-клиент из ``next=``,
сервисный поддомен), и показывает «Войти в <Сервис>» (``app/oidc/branding.py``).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates

from ..config import get_default_landing, get_invite_code, get_static_version
from ..oidc.branding import resolve_brand
from ..oidc.vk_upstream import safe_next
from ..services_catalog import get_services

logger = logging.getLogger(__name__)
router = APIRouter()

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


def _base_context(request: Request) -> Dict[str, Any]:
    """Общий контекст шаблонов (версия статики — для cache-busting)."""
    return {"request": request, "STATIC_VERSION": get_static_version()}


def build_condition_cards() -> list:
    """Карточки условий услуг.

    Источник условий живёт в Сарафане (``modules/service_conditions.py``) и в
    этот сервис пока не переехал. Каталог обязан работать и без них — поэтому
    здесь пустой список, а шаблон просто ничего не показывает. Когда источник
    переедет — подключим его здесь (структура карточек: title, emoji,
    conditions[{question, then, documents[], owner, source_ref}]).
    """
    return []


@router.get("/")
async def login_page(request: Request):
    """Страница входа ЕСА."""
    raw_next = request.query_params.get("next")
    # Валидация next на сервере (клиентский JS ей только пользуется): свои
    # относительные пути и абсолютные URL в зоне сессионной куки (единый вход).
    # Чужое/битое → None (safe_next вернул дефолт, а не сам вход).
    resolved_next = None
    if raw_next:
        candidate = safe_next(raw_next)
        resolved_next = candidate if candidate == raw_next else None

    brand = await resolve_brand(raw_next, request.headers.get("host"))
    # Уже вошедший видит, кто он, и кнопку «Выйти из всех сервисов»: выход на
    # сайте-клиенте гасит только сайт, а сессия ЕСА живёт кукой всего домена.
    current = getattr(request.state, "user", None)
    current_login = None
    if current is not None:
        current_login = (
            getattr(current, "display_name", None) or getattr(current, "login", None) or "аккаунт"
        )
    context = {
        **_base_context(request),
        "brand": brand,
        "safe_next": resolved_next,
        "current_login": current_login,
        "logged_out": request.query_params.get("logged_out") == "1",
        # Прямое требование клиента о свежести входа (OIDC prompt=login /
        # max_age): клиент уже залогинил переспросить вход, и без куки с
        # подписью формат переспроса не отличить.
        "reauth": request.query_params.get("reauth") == "1",
        "default_landing": get_default_landing(),
        # Регистрация закрыта инвайт-кодом? (env ESA_INVITE_CODE задан)
        "invite_required": bool(get_invite_code()),
    }
    return templates.TemplateResponse(request, "login.html", context)


@router.get("/login")
async def login_page_alias(request: Request):
    """Совместимый адрес страницы входа (тот же шаблон)."""
    return await login_page(request)


@router.get("/services")
async def services_page(request: Request):
    """Каталог сервисов экосистемы (public)."""
    context = {
        **_base_context(request),
        "services": get_services(),
        "condition_cards": build_condition_cards(),
    }
    return templates.TemplateResponse(request, "services.html", context)
