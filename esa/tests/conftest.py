"""Фикстуры тестов ЕСА.

Тесты идут на SQLite + aiosqlite (внешних сервисов нет): Postgres не нужен,
Redis не нужен, ключ подписи — сгенерированный на лету.
"""

from __future__ import annotations

import os
from typing import Optional

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient

from app.auth import hash_password, issue_session_token, password_fragment
from app.db import Base, configure, dispose, get_sessionmaker
from app.main import create_app
from app.models import OAuthClient, RadarUser

TEST_ISSUER = "https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai"
TEST_WEB_SECRET = "test-web-secret-esa"
TEST_INTERNAL_TOKEN = "test-internal-token"


def _generate_rsa_pem() -> bytes:
    """Свежий RSA-ключ для подписи (тестовый, никакого отношения к проду)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


@pytest.fixture(scope="session", autouse=True)
def env(tmp_path_factory) -> None:
    """Окружение тестов: секреты, issuer, путь к ключу."""
    key_path = tmp_path_factory.mktemp("keys") / "esa_test_rs256.pem"
    key_path.write_bytes(_generate_rsa_pem())

    os.environ["ESA_WEB_SECRET"] = TEST_WEB_SECRET
    os.environ["ESA_INTERNAL_TOKEN"] = TEST_INTERNAL_TOKEN
    os.environ["ESA_ISSUER"] = TEST_ISSUER
    os.environ["ESA_PRIVATE_KEY_FILE"] = str(key_path)
    os.environ["ESA_SESSION_COOKIE_SECURE"] = "1"
    # Кука без домена: тестовый клиент ходит на «testserver», доменная кука
    # до него не доехала бы. Домен проверяется отдельным тестом (env).
    os.environ.pop("ESA_SESSION_COOKIE_DOMAIN", None)
    os.environ.pop("SESSION_COOKIE_DOMAIN", None)
    # Регистрация открыта по умолчанию; тесты с инвайтом включают его сами.
    os.environ.pop("ESA_INVITE_CODE", None)


@pytest.fixture
async def db(tmp_path, monkeypatch):
    """Свежая база SQLite на каждый тест + схема."""
    url = f"sqlite+aiosqlite:///{tmp_path / 'esa_test.db'}"
    monkeypatch.setenv("ESA_DATABASE_URL", url)
    engine = configure(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await dispose()


@pytest.fixture
async def session(db):
    """Сессия БД для подготовки данных."""
    async with get_sessionmaker()() as s:
        yield s


@pytest.fixture
async def client(db):
    """HTTP-клиент по приложению (ASGI, без сокета).

    Схема ``https``: сессионная кука в проде secure, а браузер/httpx не
    отправляют secure-куку по http — на https она доезжает, как в бою.
    """
    app = create_app()
    transport = ASGITransport(app=app, client=("127.0.0.1", 5555))
    async with AsyncClient(transport=transport, base_url="https://testserver") as http:
        yield http


@pytest.fixture
async def client_from_outside(db):
    """HTTP-клиент, который пришёл НЕ с loopback (проверка гейта /internal)."""
    app = create_app()
    transport = ASGITransport(app=app, client=("203.0.113.7", 4444))
    async with AsyncClient(transport=transport, base_url="https://testserver") as http:
        yield http


@pytest.fixture
async def make_user(session):
    """Создать аккаунт ЕСА."""

    async def _make(
        login: str = "user1",
        password: str = "secret-pass",
        role: str = "radar",
        email: Optional[str] = None,
        email_verified: bool = False,
        display_name: Optional[str] = None,
        is_active: bool = True,
    ) -> RadarUser:
        user = RadarUser(
            login=login.lower(),
            password_hash=hash_password(password),
            role=role,
            is_active=is_active,
            email=email,
            email_verified=email_verified,
            display_name=display_name,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user

    return _make


@pytest.fixture
async def make_oauth_client(session):
    """Зарегистрировать OIDC-клиента."""

    async def _make(
        client_id: str = "test-client",
        redirect_uris: Optional[list[str]] = None,
        allowed_scopes: str = "openid profile email",
        is_confidential: bool = False,
        client_secret: Optional[str] = None,
        is_active: bool = True,
    ) -> OAuthClient:
        client = OAuthClient(
            client_id=client_id,
            name="Тестовый клиент",
            redirect_uris=redirect_uris if redirect_uris is not None else ["https://client.example/cb"],
            allowed_scopes=allowed_scopes,
            is_confidential=is_confidential,
            client_secret_hash=hash_password(client_secret) if client_secret else None,
            is_active=is_active,
        )
        session.add(client)
        await session.commit()
        await session.refresh(client)
        return client

    return _make


@pytest.fixture
def session_token():
    """Собрать сессионный токен для пользователя (как ЕСА кладёт в куку)."""

    def _token(user: RadarUser) -> str:
        return issue_session_token(user.id, user.role, password_fragment(user.password_hash or ""))

    return _token
