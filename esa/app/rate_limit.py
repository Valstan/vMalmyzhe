"""Rate-limit в процессе: fixed-window по IP.

В Сарафане лимиты считались Redis'ом (``GatewayQuota``). В ЕСА Redis'а нет
(сервис маленький и отдельный), поэтому лимитер свой, в памяти процесса.

Осознанное упрощение: **один процесс — один счётчик**. При нескольких
воркерах uvicorn лимит умножается на число воркеров, а при рестарте счётчики
обнуляются. Для входа посетителей (люди, не боты) этого достаточно; если
впереди появится горизонтальное масштабирование — счётчик уедет в Redis.

Счётчик — по паре (окно, IP): минутное окно и суточное окно считаются
независимо, оба ограничивают запрос.
"""

from __future__ import annotations

import threading
import time
from typing import Dict, Optional, Tuple

MINUTE = 60
DAY = 24 * 60 * 60


class FixedWindowLimiter:
    """Fixed-window счётчик по IP: N в минуту и M в сутки.

    ``check`` возвращает ``(allowed, retry_after)``: ``retry_after`` — через
    сколько секунд окно сдвинется (для заголовка ``Retry-After``).
    """

    def __init__(self, per_minute: int = 30, per_day: int = 2000) -> None:
        self.per_minute = per_minute
        self.per_day = per_day
        self._lock = threading.Lock()
        # ключ → (окно_начало, счётчик)
        self._counters: Dict[str, Tuple[float, int]] = {}

    def _consume(self, key: str, window: int, limit: int, now: float) -> Tuple[bool, int]:
        start, count = self._counters.get(key, (0.0, 0))
        if now - start >= window:
            start, count = now, 0
        if count >= limit:
            return False, int(window - (now - start)) + 1
        self._counters[key] = (start, count + 1)
        return True, 0

    def check(self, bucket: str, ip: str, now: Optional[float] = None) -> Tuple[bool, int]:
        """Проверить и израсходовать один запрос.

        ``bucket`` — окно (authorize/token/vk-login/...), ``ip`` — адрес.
        """
        now = time.time() if now is None else now
        with self._lock:
            minute_ok, retry = self._consume(f"m:{bucket}:{ip}", MINUTE, self.per_minute, now)
            if not minute_ok:
                return False, retry
            day_ok, retry = self._consume(f"d:{bucket}:{ip}", DAY, self.per_day, now)
            if not day_ok:
                return False, retry
            self._prune(now)
            return True, 0

    def _prune(self, now: float) -> None:
        """Выбросить истёкшие окна (память не должна расти вечно)."""
        if len(self._counters) < 2048:
            return
        stale = [key for key, (start, _count) in self._counters.items() if now - start >= DAY]
        for key in stale:
            self._counters.pop(key, None)

    def reset(self) -> None:
        """Сбросить счётчики (тесты)."""
        with self._lock:
            self._counters.clear()


_limiter: Optional[FixedWindowLimiter] = None
_limiter_lock = threading.Lock()


def get_limiter() -> FixedWindowLimiter:
    """Лимитер процесса (создаётся один раз)."""
    global _limiter
    if _limiter is None:
        with _limiter_lock:
            if _limiter is None:
                from .config import get_rate_per_day, get_rate_per_min

                _limiter = FixedWindowLimiter(get_rate_per_min(), get_rate_per_day())
    return _limiter
