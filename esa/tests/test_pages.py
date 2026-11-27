"""Публичные страницы ЕСА, health и статика."""

from __future__ import annotations


async def test_health_endpoint(client):
    """Health отвечает ok."""
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


async def test_root_is_login_page(client):
    """Корень ЕСА — страница входа."""
    resp = await client.get("/")
    assert resp.status_code == 200
    assert "Войти в" in resp.text
    assert "Сервисы Малмыжа" in resp.text


async def test_login_alias_page(client):
    """Совместимый адрес /login отдаёт ту же страницу входа."""
    resp = await client.get("/login")
    assert resp.status_code == 200
    assert "Войти в" in resp.text


async def test_login_page_shows_current_user(client, make_user):
    """Вошедший видит себя и кнопку выхода."""
    await make_user(display_name="Иван")
    await client.post("/api/auth/login", json={"login": "user1", "password": "secret-pass"})
    resp = await client.get("/")
    assert resp.status_code == 200
    assert "Иван" in resp.text
    assert "Выйти из всех сервисов" in resp.text


async def test_login_page_drops_foreign_next(client):
    """Чужой next в страницу входа не попадает (анти-open-redirect)."""
    resp = await client.get("/", params={"next": "https://evil.example/steal"})
    assert resp.status_code == 200
    assert "evil.example" not in resp.text


async def test_services_page_lists_catalog(client):
    """Каталог показывает сервисы экосистемы."""
    resp = await client.get("/services")
    assert resp.status_code == 200
    assert "Сервисы Малмыжа" in resp.text
    assert "вМалмыже.РФ" in resp.text


async def test_services_page_works_without_condition_cards(client):
    """Каталог работает без слоя условий (источник условий пока не переехал)."""
    resp = await client.get("/services")
    assert resp.status_code == 200
    assert "Условия услуг" in resp.text


async def test_static_bootstrap_is_served(client):
    """Оформление страницы входа отдаёт сам сервис."""
    resp = await client.get("/static/vendor/bootstrap/bootstrap.min.css")
    assert resp.status_code == 200
    assert "bootstrap" in resp.text.lower()


async def test_static_icons_are_served(client):
    """Иконки и шрифт отдаются сервисом."""
    css = await client.get("/static/vendor/bootstrap-icons/bootstrap-icons.css")
    assert css.status_code == 200
    font = await client.get("/static/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2")
    assert font.status_code == 200
