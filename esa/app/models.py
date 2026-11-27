"""Модели ЕСА: четыре таблицы, перенесённые из Сарафана без изменений.

Имена таблиц и колонок, типы и nullability — РОВНО как в старой базе
(``database/models_extended.py`` Сарафана), чтобы перенос строк был прямой
(``INSERT ... SELECT`` без переименований). Отброшены только relationship-модели
Сарафана (Region и прочие) — сервису они не нужны.

Таблицы:
- ``radar_users``         — аккаунты ЕСА (парольные и ВК-аккаунты);
- ``oauth_clients``       — зарегистрированные OIDC-клиенты;
- ``oauth_auth_codes``    — одноразовые коды авторизации;
- ``oauth_refresh_tokens``— refresh-токены (ротация + reuse-detection).

Замечание про UUID: в старой базе ``radar_users.sub`` и
``oauth_refresh_tokens.family_id`` — колонки типа ``uuid``. Здесь взят
переносимый ``Uuid(as_uuid=False)``: на PostgreSQL это тот же ``uuid``
(значения остаются строками на стороне Python), на SQLite — ``CHAR(32)``,
что нужно тестам.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    func,
)

from .clock import utcnow
from .db import Base


def _new_sub() -> str:
    """Opaque OIDC subject для нового аккаунта (ADR-0002 §2)."""
    return str(uuid.uuid4())


class RadarUser(Base):
    """Аккаунт единого входа: владелец, radar-пользователь или ВК-аккаунт.

    Роли: ``operator`` — операторская зона Сарафана; ``radar`` — обычный
    пользователь экосистемы (роль выдаёт и публичная регистрация).
    """

    __tablename__ = "radar_users"

    id = Column(Integer, primary_key=True, index=True)
    # login/password_hash nullable с миграции 052 (соц-only аккаунты без пароля).
    login = Column(String(64), nullable=True, unique=True, index=True)
    password_hash = Column(String(256), nullable=True)
    role = Column(String(16), nullable=False, default="radar")  # operator|radar
    is_active = Column(Boolean, nullable=False, default=True)

    # Аккаунт-слой OIDC (ADR-0002 §2). sub — opaque OIDC subject, НЕ serial PK.
    sub = Column(Uuid(as_uuid=False), nullable=False, unique=True, index=True, default=_new_sub)
    email = Column(String(255), nullable=True)  # unique по lower(email) в БД
    email_verified = Column(Boolean, nullable=False, default=False)
    display_name = Column(String(128), nullable=True)
    vk_user_id = Column(BigInteger, nullable=True)  # partial-unique в БД
    telegram_user_id = Column(BigInteger, nullable=True)  # partial-unique в БД
    yandex_id = Column(String(64), nullable=True)  # partial-unique в БД

    quota_bytes = Column(BigInteger, nullable=False, default=209_715_200)  # 200 MB
    used_bytes = Column(BigInteger, nullable=False, default=0)

    created_at = Column(DateTime, default=utcnow, nullable=False)
    last_login_at = Column(DateTime, nullable=True)

    # Курсор новизны ленты (осталось от Сарафана; в ЕСА не используется).
    last_seen_item_id = Column(BigInteger, nullable=True)

    # Частичные уникальные индексы — как в старой базе (миграции 052 и 108).
    # Они не колонки, а ограничения целостности, на которые опирается код
    # (например, дозаполнение email при ВК-входе: адрес уникален по
    # lower(email), иначе запись упала бы на IntegrityError). ``create_all``
    # индексы из моделей создаёт, а из дампа ``--data-only`` они не приедут —
    # поэтому они объявлены здесь.
    __table_args__ = (
        Index(
            "uq_radar_users_email_lower",
            func.lower(email),
            unique=True,
            postgresql_where=email.isnot(None),
            sqlite_where=email.isnot(None),
        ),
        Index(
            "uq_radar_users_login_lower",
            func.lower(login),
            unique=True,
            postgresql_where=login.isnot(None),
            sqlite_where=login.isnot(None),
        ),
        Index(
            "uq_radar_users_vk_user_id",
            vk_user_id,
            unique=True,
            postgresql_where=vk_user_id.isnot(None),
            sqlite_where=vk_user_id.isnot(None),
        ),
        Index(
            "uq_radar_users_telegram_user_id",
            telegram_user_id,
            unique=True,
            postgresql_where=telegram_user_id.isnot(None),
            sqlite_where=telegram_user_id.isnot(None),
        ),
        Index(
            "uq_radar_users_yandex_id",
            yandex_id,
            unique=True,
            postgresql_where=yandex_id.isnot(None),
            sqlite_where=yandex_id.isnot(None),
        ),
    )

    def __repr__(self) -> str:
        return f"<RadarUser {self.login} role={self.role} active={self.is_active}>"

    def to_dict(self) -> Dict[str, Any]:
        """Служебное представление (панель Сарафана)."""
        return {
            "id": self.id,
            "login": self.login,
            "role": self.role,
            "is_active": self.is_active,
            "quota_bytes": self.quota_bytes,
            "used_bytes": self.used_bytes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
        }

    def identity_dict(self) -> Dict[str, Any]:
        """Идентичность для внутреннего API (портал вмалмыже.рф).

        ``email_verified`` — обязателен: портал кладёт адрес в свою сессию
        только при ``true`` (анти-захват аккаунта).
        """
        return {
            "sub": self.sub,
            "login": self.login,
            "email": self.email,
            "email_verified": bool(self.email_verified),
            "display_name": self.display_name,
            "role": self.role,
        }


class OAuthClient(Base):
    """OIDC-клиент ЕСА (ручная регистрация оператором).

    ``redirect_uris`` — JSON-массив ТОЧНЫХ uri (символ-в-символ, punycode
    для .рф — G108). ``allowed_scopes`` — space-separated потолок: клиент
    физически не получит claims сверх разрешённого (ADR-0002 §3).
    """

    __tablename__ = "oauth_clients"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(String(64), nullable=False, unique=True, index=True)
    client_secret_hash = Column(String(256), nullable=True)  # NULL = public PKCE-only
    name = Column(String(128), nullable=False)
    redirect_uris = Column(JSON, nullable=False, default=list)
    allowed_scopes = Column(String(255), nullable=False, default="openid")
    # Брендинг страницы единого входа: {"title","icon","accent","sub"}.
    # NULL = страница покажет name.
    branding = Column(JSON, nullable=True)
    is_confidential = Column(Boolean, nullable=False, default=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    def scope_list(self) -> List[str]:
        return [s for s in (self.allowed_scopes or "").split() if s]

    def __repr__(self) -> str:
        return f"<OAuthClient {self.client_id} ({self.name})>"


class OAuthAuthCode(Base):
    """Single-use authorization code.

    Храним sha256(code), не сырой код. Single-use enforce'ится ``used_at``:
    повторный обмен кода — признак атаки/бага, отклоняем.
    """

    __tablename__ = "oauth_auth_codes"

    # BIGSERIAL в PG; variant Integer — автоинкремент в SQLite-тестах.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    code_hash = Column(String(128), nullable=False, unique=True, index=True)
    client_id = Column(String(64), nullable=False)
    user_id = Column(Integer, ForeignKey("radar_users.id", ondelete="CASCADE"), nullable=False)
    redirect_uri = Column(Text, nullable=False)
    scope = Column(String(255), nullable=False)
    code_challenge = Column(String(128), nullable=True)
    code_challenge_method = Column(String(10), nullable=True)  # S256
    nonce = Column(String(255), nullable=True)
    # Когда человек реально аутентифицировался (``iat`` его сессии), а не когда
    # выдан код. NULL — время входа неизвестно: тогда ЕСА не заявляет
    # `auth_time` вовсе, а не подставляет «сейчас».
    auth_time = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<OAuthAuthCode client={self.client_id} user={self.user_id}>"


class OAuthRefreshToken(Base):
    """Refresh-токен с ротацией и family-based reuse-detection (ADR-0002 §5.2).

    Все ротации одной сессии делят ``family_id``; предъявление уже
    погашенного (rotated/revoked) токена → отзыв всей family.
    """

    __tablename__ = "oauth_refresh_tokens"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    token_hash = Column(String(128), nullable=False, unique=True, index=True)
    family_id = Column(Uuid(as_uuid=False), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("radar_users.id", ondelete="CASCADE"), nullable=False)
    client_id = Column(String(64), nullable=False)
    scope = Column(String(255), nullable=False)
    rotated_from = Column(BigInteger, nullable=True)
    # Время входа едет по цепочке ротаций неизменным: обновление токена — не
    # аутентификация. NULL — вход неизвестен, `auth_time` не заявляется.
    auth_time = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<OAuthRefreshToken family={self.family_id} user={self.user_id}>"


__all__ = ["Base", "OAuthAuthCode", "OAuthClient", "OAuthRefreshToken", "RadarUser"]
