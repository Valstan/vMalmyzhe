"""Создание схемы БД ЕСА: ``python -m app.init_db``.

Зачем отдельная команда. Данные переезжают из старой базы Сарафана дампом
``--data-only`` (схему создаёт сервис, данные — дамп), поэтому нужно уметь
поднять пустую базу с ТОЧНО теми же таблицами и колонками, что в старой базе:

- ``radar_users``            (в т.ч. ``sub`` — UUID, строкой в Python);
- ``oauth_clients``          (``redirect_uris`` — JSON, ``allowed_scopes`` — VARCHAR);
- ``oauth_auth_codes``;
- ``oauth_refresh_tokens``.

Команда идемпотентна: повторный запуск не падает и ничего не пересоздаёт.
Ровно то же самое делает сервис при старте (тот же ``create_all``), поэтому
свежий запуск без дампа тоже работает.

Использование (из каталога ``esa/``):
    ESA_DATABASE_URL=postgresql://... python -m app.init_db
"""

from __future__ import annotations

import asyncio
import logging
import sys

from sqlalchemy import inspect

from . import models  # noqa: F401 - импорт регистрирует таблицы в Base.metadata
from .db import Base, configure, dispose

logger = logging.getLogger(__name__)


async def _create_schema() -> tuple[list[str], list[str]]:
    """Создать схему; вернуть (созданные, уже бывшие)."""
    engine = configure()
    async with engine.begin() as conn:
        before = await conn.run_sync(lambda c: inspect(c).get_table_names())
        await conn.run_sync(Base.metadata.create_all)
        after = await conn.run_sync(lambda c: inspect(c).get_table_names())
    created = sorted(set(after) - set(before))
    existed = sorted(set(after) & set(before))
    return created, existed


def main(argv: list[str] | None = None) -> int:
    """Точка входа: создать схему и напечатать, что создано."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    argv = list(sys.argv[1:] if argv is None else argv)

    created, existed = asyncio.run(_create_schema())
    print(f"База: {_safe_database_label()}")
    if created:
        print("Созданы таблицы:")
        for name in created:
            print(f"  + {name}")
    if existed:
        print("Уже были (оставлены как есть):")
        for name in existed:
            print(f"  = {name}")
    if not created and not existed:
        print("В базе нет ни одной таблицы ЕСА — проверьте DATABASE_URL.")
    asyncio.run(dispose())
    return 0


def _safe_database_label() -> str:
    """DSN без пароля (в лог уходит только хост и имя базы)."""
    from .config import get_database_url

    try:
        url = get_database_url()
    except RuntimeError as e:
        return f"<не задан: {e}>"
    if "@" in url:
        url = url.rsplit("@", 1)[1]
    return url


if __name__ == "__main__":
    raise SystemExit(main())
