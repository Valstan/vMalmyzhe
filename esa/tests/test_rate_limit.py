"""Rate-limit в процессе: fixed-window по IP."""

from __future__ import annotations

from app.rate_limit import FixedWindowLimiter


def test_limit_per_minute():
    """После N запросов в минуту — отказ с retry_after."""
    limiter = FixedWindowLimiter(per_minute=3, per_day=100)
    now = 1_000_000.0
    for _ in range(3):
        allowed, _retry = limiter.check("authorize", "1.2.3.4", now=now)
        assert allowed is True
    allowed, retry = limiter.check("authorize", "1.2.3.4", now=now)
    assert allowed is False
    assert retry > 0


def test_windows_are_independent_per_bucket():
    """У authorize и token — свои счётчики."""
    limiter = FixedWindowLimiter(per_minute=1, per_day=100)
    now = 1_000_000.0
    assert limiter.check("authorize", "1.2.3.4", now=now)[0] is True
    assert limiter.check("authorize", "1.2.3.4", now=now)[0] is False
    assert limiter.check("token", "1.2.3.4", now=now)[0] is True


def test_windows_are_independent_per_ip():
    """У разных IP — свои счётчики."""
    limiter = FixedWindowLimiter(per_minute=1, per_day=100)
    now = 1_000_000.0
    assert limiter.check("authorize", "1.2.3.4", now=now)[0] is True
    assert limiter.check("authorize", "5.6.7.8", now=now)[0] is True


def test_minute_window_resets():
    """Через минуту окно сдвигается и лимит снова доступен."""
    limiter = FixedWindowLimiter(per_minute=1, per_day=100)
    now = 1_000_000.0
    assert limiter.check("authorize", "1.2.3.4", now=now)[0] is True
    assert limiter.check("authorize", "1.2.3.4", now=now)[0] is False
    assert limiter.check("authorize", "1.2.3.4", now=now + 61)[0] is True


def test_daily_limit():
    """Суточное окно ограничивает отдельно от минутного."""
    limiter = FixedWindowLimiter(per_minute=100, per_day=2)
    now = 1_000_000.0
    assert limiter.check("token", "1.2.3.4", now=now)[0] is True
    assert limiter.check("token", "1.2.3.4", now=now + 61)[0] is True
    allowed, retry = limiter.check("token", "1.2.3.4", now=now + 122)
    assert allowed is False
    assert retry > 0


def test_default_limits_match_legacy_values():
    """Канонические лимиты — 30 в минуту и 2000 в сутки (как в Сарафане)."""
    from app.config import get_rate_per_day, get_rate_per_min

    assert get_rate_per_min() == 30
    assert get_rate_per_day() == 2000
