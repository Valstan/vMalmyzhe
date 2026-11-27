"""Обработчики ошибок приложения: тело ответа должно быть JSON.

Живой дефект (28.11): обработчик ошибки валидации отдавал ``exc.errors()``
целиком, а в ``ctx`` ошибки лежит несериализуемое значение (байты) — ``json.dumps``
падал, и клиент получал 500 вместо 422. То есть «плохой запрос» выглядел как
«сервер сломан». Тест держит границу: плохое тело → 422 с JSON, а не 500.
"""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_malformed_body_gives_422_not_500(client):
    """Форма не в том формате → 422 (не 500) и тело — JSON."""
    res = await client.post(
        "/api/auth/login",
        data="login=user1&password=secret-pass",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert res.status_code == 422, res.text
    assert res.headers["content-type"].startswith("application/json")
    assert isinstance(res.json().get("detail"), list)


@pytest.mark.asyncio
async def test_validation_error_detail_has_no_unserializable_values(client):
    """Тело ответа собирается само: loc/msg/type — строки, без ctx."""
    res = await client.post(
        "/api/auth/login",
        json={"login": "", "password": ""},
    )
    assert res.status_code == 422, res.text
    detail = res.json()["detail"]
    assert detail, "пустой detail — клиенту нечего показать"
    for item in detail:
        assert set(item) <= {"loc", "msg", "type"}
        assert all(isinstance(part, str) for part in item["loc"])


@pytest.mark.asyncio
async def test_internal_api_malformed_body_gives_400(client):
    """Внутренний API по контракту отвечает 400, а не 422."""
    res = await client.post(
        "/internal/auth/login",
        content=b"not-json",
        headers={
            "Content-Type": "application/json",
            "X-ESA-Internal-Token": "test-internal-token",
        },
    )
    assert res.status_code == 400, res.text
    assert res.json()["detail"] == "Некорректные данные запроса"
