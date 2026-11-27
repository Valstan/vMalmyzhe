"""Доступ к базе: async SQLAlchemy 2.x (asyncpg на проде, aiosqlite в тестах).

Движок и фабрика сессий — ленивые, читают ``ESA_DATABASE_URL`` при первом
обращении. Так конфиг окружения можно выставить после импорта приложения,
а тесты — пересоздавать базу на каждый кейс (``configure``).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import declarative_base

from .config import get_database_url

logger = logging.getLogger(__name__)

Base = declarative_base()

_engine: Optional[AsyncEngine] = None
_sessionmaker: Optional[async_sessionmaker[AsyncSession]] = None


def _engine_kwargs(url: str) -> dict:
    """Параметры движка.

    ``pool_pre_ping``/``pool_size`` — только для PostgreSQL: у SQLite свои
    пулы (NullPool/StaticPool), и эти параметры там неприменимы.
    """
    kwargs: dict = {"echo": False, "future": True}
    if url.startswith("postgresql"):
        kwargs.update(pool_pre_ping=True, pool_recycle=1800, pool_size=3, max_overflow=5)
    return kwargs


def configure(url: Optional[str] = None, **kwargs) -> AsyncEngine:
    """Создать (или пересоздать) движок и фабрику сессий.

    Вызывается на старте приложения неявно (первый запрос) и в тестах — под
    свою базу.
    """
    global _engine, _sessionmaker
    url = url or get_database_url()
    _engine = create_async_engine(url, **{**_engine_kwargs(url), **kwargs})
    _sessionmaker = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
    return _engine


def get_engine() -> AsyncEngine:
    """Движок (создаётся при первом обращении)."""
    if _engine is None:
        configure()
    assert _engine is not None
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Фабрика асинхронных сессий."""
    if _sessionmaker is None:
        get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Сессия с коммитом/откатом по выходу из блока."""
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose() -> None:
    """Закрыть движок (вызывается на остановке приложения и в тестах)."""
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
