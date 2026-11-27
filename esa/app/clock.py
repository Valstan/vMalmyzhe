"""Единый источник «сейчас» для сервиса.

В старой базе Сарафана все временные метки — наивный UTC (без tzinfo):
``datetime.utcnow()``. Чтобы миграция строк в новую базу была прямой и
сравнения не ломались, здесь тоже наивный UTC.

``datetime.utcnow()`` в Python 3.12 помечен deprecated, поэтому берём
``datetime.now(timezone.utc)`` и снимаем tzinfo.
"""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Наивный UTC (без tzinfo) — формат дат старой базы."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def from_timestamp(ts: float) -> datetime:
    """Наивный UTC из POSIX-времени (секунды)."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).replace(tzinfo=None)
