"""Конфиг ЕСА — OIDC-провайдера единого входа экосистемы Малмыжа.

Вынесен из ``config/radar_id.py`` Сарафана. Смысл переменных окружения тот
же, имена — свои (``ESA_*``), чтобы сервис можно было поднять рядом со
старым и не путать, где чьё.

Переход (миграция) учтён фолбэками на старые имена: если ``ESA_*`` не
задана, берётся прежняя переменная (``RADAR_ID_*`` / ``SETKA_*``), иначе
переезд на новый сервис потребовал бы переписывания всех env-файлов.
Секрет сессий — **тот же самый** (``SETKA_WEB_SECRET``), поэтому уже выданные
живые сессии продолжают работать.

Секреты — только в env (prod-env бокса). Приватный RS256-ключ — файлом вне
репозитория (потеря ключа = перевыпуск для всей экосистемы).

Полный список переменных — в ``esa/README.md``.
"""

from __future__ import annotations

import os

# Issuer: канонический публичный домен единого входа (вход.вмалмыже.рф).
# В URL — punycode символ-в-символ (G108/R16): та же строка обязана стоять
# в конфиге каждого клиента и в ВК-приложении. Строка НЕ меняется при переезде
# сервиса на другой бокс — иначе отвалятся все зарегистрированные клиенты.
DEFAULT_ISSUER = "https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai"

# Кука сессии: имя и домен — как в Сарафане (общий вход на .вмалмыже.рф).
DEFAULT_SESSION_COOKIE = "setka_session"

# Приватный RS256-ключ по умолчанию — тот же путь, что был на боксе Сарафана.
DEFAULT_PRIVATE_KEY_FILE = "/etc/setka/radar_id_rs256.pem"

# Scopes, которые ЕСА вообще умеет (суперсет; per-client потолок —
# oauth_clients.allowed_scopes).
SUPPORTED_SCOPES = ("openid", "profile", "email")

# Логины владельца — зарезервированы, не регистрируются (список — константа,
# не секрет; переопределяется env ESA_OWNER_LOGINS).
OWNER_LOGINS_DEFAULT = "valstan"

# Куда возвращать человека, если «next» не задан (страница каталога ЕСА).
DEFAULT_LANDING = "/services"


def _env(*names: str, default: str = "") -> str:
    """Первое непустое значение из списка переменных окружения.

    Пустая или пробельная переменная считается «не задана» — так же, как в
    Сарафане: пустой ``SETKA_OWNER_LOGINS=`` не должен означать «владельцев
    нет вообще».
    """
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return value.strip()
    return default


def _int_env(*names: str, default: int) -> int:
    """Целое из env; битое значение — дефолт (сервис не должен падать на мусоре)."""
    raw = _env(*names)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


# ---------------------------------------------------------------------------
# Идентификация провайдера
# ---------------------------------------------------------------------------


def get_issuer() -> str:
    """Issuer OIDC (без хвостового слэша)."""
    return _env("ESA_ISSUER", "RADAR_ID_ISSUER", default=DEFAULT_ISSUER).rstrip("/")


def get_private_key_file() -> str:
    """Путь к приватному RS256-ключу (PEM)."""
    return _env(
        "ESA_PRIVATE_KEY_FILE",
        "RADAR_ID_PRIVATE_KEY_FILE",
        default=DEFAULT_PRIVATE_KEY_FILE,
    )


def esa_disabled() -> bool:
    """Kill-switch OIDC-поверхности (дефолт — включена)."""
    return _env("ESA_DISABLED", "RADAR_ID_DISABLED").lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------------------
# Время жизни токенов
# ---------------------------------------------------------------------------


def get_access_token_ttl() -> int:
    """Сек жизни access/id-токена (короткие — принцип ADR-0002 §5.2)."""
    return _int_env("ESA_ACCESS_TOKEN_TTL", "RADAR_ID_ACCESS_TOKEN_TTL", default=600)


def get_auth_code_ttl() -> int:
    """Сек жизни authorization code (одноразовый)."""
    return _int_env("ESA_AUTH_CODE_TTL", "RADAR_ID_AUTH_CODE_TTL", default=60)


def get_refresh_ttl_days() -> int:
    """Дней жизни refresh-токена."""
    return _int_env("ESA_REFRESH_TTL_DAYS", "RADAR_ID_REFRESH_TTL_DAYS", default=30)


# ---------------------------------------------------------------------------
# База
# ---------------------------------------------------------------------------


def get_database_url() -> str:
    """DSN базы. Обязателен: дефолт-адреса нет — пустое значение должно падать."""
    url = _env("ESA_DATABASE_URL", "DATABASE_URL")
    if not url:
        raise RuntimeError(
            "ESA_DATABASE_URL is not set. Store it server-side (prod-env of the box) "
            "and configure the service (systemd) to load it."
        )
    return url


# ---------------------------------------------------------------------------
# Сессии и куки
# ---------------------------------------------------------------------------


def get_web_secret() -> str:
    """Секрет подписи сессий (пусто → ephemeral, см. ``app.auth._secret``)."""
    return _env("ESA_WEB_SECRET", "SETKA_WEB_SECRET")


def get_session_cookie_name() -> str:
    """Имя сессионной куки ЕСА (общее для всей зоны .вмалмыже.рф)."""
    return _env("ESA_SESSION_COOKIE", default=DEFAULT_SESSION_COOKIE)


def get_session_cookie_domain() -> str | None:
    """Домен сессионной куки (``.вмалмыже.рф`` в punycode) или None (host-only)."""
    return _env("ESA_SESSION_COOKIE_DOMAIN", "SESSION_COOKIE_DOMAIN") or None


def get_session_cookie_secure() -> bool:
    """Ставить ли флаг Secure на сессионную куку (на проде — только HTTPS)."""
    return _env("ESA_SESSION_COOKIE_SECURE", "SESSION_COOKIE_SECURE", default="1") == "1"


def get_owner_logins() -> frozenset[str]:
    """Логины владельца: зарезервированы, не регистрируются."""
    raw = _env("ESA_OWNER_LOGINS", "SETKA_OWNER_LOGINS", default=OWNER_LOGINS_DEFAULT)
    return frozenset(part.strip().lower() for part in raw.split(",") if part.strip())


def get_default_landing() -> str:
    """Куда возвращать человека, если «next» не задан."""
    return _env("ESA_DEFAULT_LANDING", default=DEFAULT_LANDING)


# ---------------------------------------------------------------------------
# Внутренний API (портал вмалмыже.рф → ЕСА)
# ---------------------------------------------------------------------------


def get_internal_token() -> str:
    """Токен внутреннего API. Пусто → ``/internal/*`` закрыт целиком (404)."""
    return _env("ESA_INTERNAL_TOKEN")


def get_invite_code() -> str:
    """Инвайт-код регистрации. Пусто → регистрация открыта.

    Старый ``RADAR_INVITE_CODE`` здесь НЕ используется: правило инвайта в
    новом сервисе задаёт только ``ESA_INVITE_CODE``.
    """
    return _env("ESA_INVITE_CODE")


# ---------------------------------------------------------------------------
# ВК-вход (upstream VK ID)
# ---------------------------------------------------------------------------


def get_vk_app_id() -> str:
    """App ID VK ID-приложения ЕСА (публичный)."""
    return _env("ESA_VK_APP_ID", "RADAR_ID_VK_APP_ID")


def get_vk_redirect_uri() -> str:
    """redirect_uri ВК-callback — символ-в-символ как в ВК-приложении (punycode)."""
    return _env("ESA_VK_REDIRECT_URI", "RADAR_ID_VK_REDIRECT_URI") or (
        f"{get_issuer()}/auth/vk/callback"
    )


# ---------------------------------------------------------------------------
# Лимиты и статика
# ---------------------------------------------------------------------------


def get_rate_per_min() -> int:
    """Лимит запросов на IP в минуту (окно authorize/token/vk-*)."""
    return _int_env("ESA_RATE_PER_MIN", default=30)


def get_rate_per_day() -> int:
    """Лимит запросов на IP в сутки."""
    return _int_env("ESA_RATE_PER_DAY", default=2000)


def get_static_version() -> str:
    """Версия статики для cache-busting ссылок в шаблонах."""
    return _env("ESA_STATIC_VERSION", default="1")


def get_log_level() -> str:
    """Уровень логирования сервиса."""
    return _env("ESA_LOG_LEVEL", default="INFO").upper()
