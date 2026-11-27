"""ЕСА — приложение (фабрика).

Единый вход экосистемы Малмыжа: OIDC-провайдер + страница входа + каталог
сервисов + внутренний API для портала вмалмыже.рф.

Запуск (прод):
    uvicorn app.main:app --host 127.0.0.1 --port 8010

Что здесь принципиально:
- **CORS не включаем**: внутренний API доступен только с loopback, а публичные
  OIDC-эндпоинты клиенты зовут сервером-сервером (без preflight).
- **Audit-логгер** ``esa.audit`` — выдача кода, обмен кода, reuse-детект,
  logout. Отдельный логгер, чтобы его можно было забирать из journald
  отдельно от обычных логов сервиса.
- **Ошибки OIDCError** — единый обработчик: если ошибка не поймана маршрутом,
  отдаём её протокольным JSON (код + описание), а не 500.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_log_level
from .db import Base, dispose, get_engine
from .oidc.service import OidcError
from .rate_limit import get_limiter
from .routes import auth as auth_routes
from .routes import internal as internal_routes
from .routes import oidc as oidc_routes
from .routes import pages as page_routes
from .session import SessionMiddleware

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"

# Префикс внутреннего API: наружу (в интернет) эти маршруты не выставляются.
INTERNAL_PREFIX = "/internal"


def configure_logging() -> None:
    """Логи сервиса + отдельный поток audit-логов."""
    level = getattr(logging, get_log_level(), logging.INFO)
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        root.addHandler(handler)
    root.setLevel(level)

    # Audit-логгер: свои обработчики, чтобы строки аудита не мешались в общем
    # потоке (и чтобы их можно было перенаправить в отдельный файл).
    audit = logging.getLogger("esa.audit")
    if not audit.handlers:
        audit_handler = logging.StreamHandler()
        audit_handler.setFormatter(logging.Formatter("%(asctime)s AUDIT %(name)s %(message)s"))
        audit.addHandler(audit_handler)
    audit.setLevel(logging.INFO)
    audit.propagate = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Старт/остановка сервиса.

    На старте создаём схему (тот же ``create_all``, что и в ``python -m
    app.init_db``): операция идемпотентна — повторный запуск не падает, а
    свежий запуск без дампа работает сразу.
    """
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    get_limiter()
    logger.info("esa: started")
    yield
    await dispose()


def create_app() -> FastAPI:
    """Фабрика приложения (тесты создают своё через неё)."""
    configure_logging()

    app = FastAPI(
        title="ЕСА — единый вход экосистемы",
        version="1.0.0",
        description="OIDC-провайдер входа.вмалмыже.рф",
        lifespan=lifespan,
    )

    # Сессия: разбор куки → request.state.user / request.state.session_iat.
    app.add_middleware(SessionMiddleware)

    # Статика (bootstrap + иконки) — отдаём сами, чтобы страница входа не
    # зависела от статики Сарафана.
    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # Маршруты.
    app.include_router(oidc_routes.router)
    app.include_router(auth_routes.router, prefix="/api/auth")
    app.include_router(internal_routes.router, prefix=INTERNAL_PREFIX)
    app.include_router(page_routes.router)

    @app.get("/api/health")
    async def health():
        """Живость сервиса (для nginx/мониторинга)."""
        return {"ok": True}

    @app.exception_handler(OidcError)
    async def oidc_error_handler(request: Request, exc: OidcError):
        """Протокольная ошибка OIDC, дошедшая до общего обработчика."""
        logger.warning("esa: unhandled oidc error %s: %s", exc.error, exc.description)
        return JSONResponse(
            {"error": exc.error, "error_description": exc.description},
            status_code=400,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        """Ошибка тела запроса.

        Для внутреннего API это 400 (как в контракте портала), для публичных
        эндпоинтов — стандартные 422 FastAPI (их контракт не менялся).
        """
        if request.url.path.startswith(INTERNAL_PREFIX):
            return JSONResponse({"detail": "Некорректные данные запроса"}, status_code=400)
        return JSONResponse({"detail": exc.errors()}, status_code=422)

    return app


app = create_app()
