# ЕСА — единый вход экосистемы Малмыжа

OIDC-провайдер «ЕСА» (вход.вмалмыже.рф): выдаёт клиентам экосистемы
идентичность (sub / email / name) по **Authorization Code + PKCE (S256)**,
обслуживает страницу входа и каталог сервисов, и отдаёт порталу
вмалмыже.рф внутренний API для входа и регистрации.

Сервис **вынесен из Сарафана** (решение владельца, 2026-11-27): бокс входа
живёт на боксе сайта, а не на боксе Сарафана. Код здесь **не зависит** от
репозитория Сарафана: все зависимости — pip-пакеты, никаких `sys.path` хаков
и импортов вида `from database import ...`.

---

## Что это и что это не есть

**Есть:**
- OIDC-провайдер: discovery, JWKS, authorize, token, userinfo, RP-initiated logout;
- вход через ВКонтакте (VK ID OAuth 2.1 + PKCE, upstream-метод);
- страница входа (`/`) и каталог сервисов (`/services`);
- внутренний API для портала (`/internal/*`) — вход, регистрация, «кто я», каталог;
- health (`/api/health`) и статика (bootstrap + иконки) для страниц.

**Нет (осознанно):**
- панели оператора Сарафана (дашборд, `/tokens`, `/ad`, `/posts`) — это чужая зона;
- Redis и Celery — сервис маленький и синхронный по сути;
- почты, задач, импорта ВК, Telegram/Yandex-логина;
- условий услуг в каталоге (источник условий остался в Сарафане — см. «Что осталось за рамками»);
- управления OIDC-клиентами через API (клиенты заводятся в БД вручную, как раньше).

---

## Быстрый старт (локально)

```bash
cd esa
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt

# Схема (идемпотентно; сервис создаёт её и сам при старте)
$env:ESA_DATABASE_URL = "sqlite+aiosqlite:///./esa.db"
.\.venv\Scripts\python.exe -m app.init_db

# Запуск
$env:ESA_WEB_SECRET = "любой-длинный-секрет"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Проверка: `curl http://127.0.0.1:8010/api/health` → `{"ok":true}`.

Прод (systemd) — по образцу других сервисов репозитория: `EnvironmentFile=`
с prod-env, `ExecStart=…/uvicorn app.main:app --host 127.0.0.1 --port 8010`,
рабочий каталог — каталог `esa/`.

---

## Переменные окружения

Секреты — только в env (prod-env бокса). Литералов-адресов нет: пустое значение
должно падать, а не подставлять адрес.

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `ESA_DATABASE_URL` | DSN базы (asyncpg на проде, aiosqlite в тестах). **Обязательна.** | — |
| `ESA_ISSUER` | issuer OIDC (публичный домен входа) | `https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai` (тот же, что был в Сарафане) |
| `ESA_WEB_SECRET` | секрет подписи сессионных токенов | фолбэк `SETKA_WEB_SECRET`; если нет — ephemeral на процесс + WARNING |
| `ESA_PRIVATE_KEY_FILE` | приватный RS256-ключ (PEM) | фолбэк `RADAR_ID_PRIVATE_KEY_FILE`, иначе `/etc/setka/radar_id_rs256.pem` |
| `ESA_INTERNAL_TOKEN` | токен внутреннего API (`X-ESA-Internal-Token`) | — (нет токена → `/internal/*` закрыт целиком) |
| `ESA_INVITE_CODE` | инвайт-код регистрации | — (не задан → регистрация открыта) |
| `ESA_OWNER_LOGINS` | логины владельца (зарезервированы) | фолбэк `SETKA_OWNER_LOGINS`, иначе `valstan` |
| `ESA_SESSION_COOKIE` | имя сессионной куки | `setka_session` |
| `ESA_SESSION_COOKIE_DOMAIN` | домен сессионной куки (общий вход на зону) | фолбэк `SESSION_COOKIE_DOMAIN`; пусто → host-only |
| `ESA_SESSION_COOKIE_SECURE` | флаг `Secure` на куке | фолбэк `SESSION_COOKIE_SECURE`, иначе `1` (только HTTPS) |
| `ESA_DISABLED` | аварийный kill-switch OIDC-поверхности | фолбэк `RADAR_ID_DISABLED`, иначе выключено |
| `ESA_ACCESS_TOKEN_TTL` | сек жизни access/id-токена | фолбэк `RADAR_ID_ACCESS_TOKEN_TTL`, иначе `600` |
| `ESA_AUTH_CODE_TTL` | сек жизни authorization code | фолбэк `RADAR_ID_AUTH_CODE_TTL`, иначе `60` |
| `ESA_REFRESH_TTL_DAYS` | дней жизни refresh-токена | фолбэк `RADAR_ID_REFRESH_TTL_DAYS`, иначе `30` |
| `ESA_VK_APP_ID` | App ID VK ID-приложения (публичный) | фолбэк `RADAR_ID_VK_APP_ID`; пусто → ВК-вход выключен |
| `ESA_VK_REDIRECT_URI` | redirect_uri ВК-callback | фолбэк `RADAR_ID_VK_REDIRECT_URI`, иначе `{issuer}/auth/vk/callback` |
| `ESA_DEFAULT_LANDING` | куда возвращать человека без `next` | `/services` |
| `ESA_RATE_PER_MIN` | лимит запросов на IP в минуту | `30` |
| `ESA_RATE_PER_DAY` | лимит запросов на IP в сутки | `2000` |
| `ESA_STATIC_VERSION` | версия статики (cache-busting в шаблонах) | `1` |
| `ESA_LOG_LEVEL` | уровень логирования | `INFO` |

> **Секрет сессий.** Чтобы живые сессии и выданные клиентам значения пережили
> переезд, `ESA_WEB_SECRET` должен совпадать со старым `SETKA_WEB_SECRET`.
> Формат токена сессии и формат хэша пароля **не менялись** — иначе отвалились бы
> живые сессии.

---

## Схема БД и переезд данных

Сервис работает с **четырьмя таблицами** — теми же, что были в Сарафане, с теми
же именами, колонками, типами и nullability:

| Таблица | Ключевые моменты |
|---|---|
| `radar_users` | `id INTEGER` (SERIAL), `sub UUID` (в Python — строка), `email VARCHAR(255)`, `email_verified BOOLEAN`, `password_hash VARCHAR(256)`, `role VARCHAR(16)` |
| `oauth_clients` | `client_id VARCHAR(64)`, `client_secret_hash VARCHAR(256)`, `redirect_uris JSON`, `allowed_scopes VARCHAR(255)`, `branding JSON` |
| `oauth_auth_codes` | `id BIGSERIAL`, `code_hash VARCHAR(128)`, `user_id INTEGER` → `radar_users.id` |
| `oauth_refresh_tokens` | `id BIGSERIAL`, `family_id UUID`, `user_id INTEGER` → `radar_users.id` |

Частичные уникальные индексы (`uq_radar_users_email_lower`,
`uq_radar_users_login_lower`, `uq_radar_users_vk_user_id`,
`uq_radar_users_telegram_user_id`, `uq_radar_users_yandex_id`) тоже
воспроизведены — на них опирается код (например, дозаполнение email при
ВК-входе).

**Создание схемы:**

```bash
cd esa
ESA_DATABASE_URL=postgresql://… python -m app.init_db
```

Команда печатает, какие таблицы созданы (или какие уже были). Она
**идемпотентна** — повторный запуск не падает. Ровно то же самое делает сервис
при старте (`create_all` в lifespan), поэтому свежий запуск без дампа тоже
работает.

**Перенос данных** — данные переезжают из старой базы Сарафана дампом
**`--data-only`** (схему создаёт сервис, данные — дамп):

```bash
# 1) пустая база со схемой ЕСА
ESA_DATABASE_URL=postgresql://… python -m app.init_db
# 2) только данные четырёх таблиц
pg_dump --data-only --table=radar_users --table=oauth_clients \
        --table=oauth_auth_codes --table=oauth_refresh_tokens \
        --file=esa_data.sql <старая-БД>
# 3) заливка
psql <esa_data.sql <новая-БД>
```

> Дамп **без схемы** (`--data-only`) не приносит индексы — они уже созданы
> командой выше. Если дамп сделан со схемой, его нужно лить в ПУСТУЮ базу
> (иначе таблицы и индексы уже существуют).

---

## Внутренний API (`/internal/*`) — для портала вмалмыже.рф

Портал не хранит пароли и не проверяет их сам: вход и регистрация делаются в
ЕСА, а портал получает готовый сессионный токен и кладёт его в браузер как куку
ЕСА. Так вход общий для всей зоны `.вмалмыже.рф` (включая ВК-вход: cookie одна
на домен).

**Доступ:** только с loopback (`request.client.host` ∈ {`127.0.0.1`, `::1`})
**и** заголовок `X-ESA-Internal-Token`, равный `ESA_INTERNAL_TOKEN`.
Иначе — **404** (не 403: для внешнего мира такого маршрута не существует).

> ⚠️ **nginx не должен проксировать `/internal/*` из интернета.** Проксировать
> можно только с бокса (127.0.0.1) — тогда внешний запрос всё равно упрётся в
> loopback-проверку и заголовок с токеном.

| Метод и путь | Тело | Ответ |
|---|---|---|
| `POST /internal/auth/login` | `{login, password}` | `200 {ok, user, session_token, session}` · `401` · `400` |
| `POST /internal/auth/register` | `{login, password, email?, invite_code?}` | `200 {ok, user, session_token, session}` · `409` (логин занят) · `403` (инвайт) · `400` |
| `GET /internal/auth/me` | заголовок `X-ESA-Session` | `200 {user}` · `401` |
| `GET /internal/services` | — | `200 {services: [{title, emoji, url, desc}]}` |

**Идентичность** (`user`) — ровно этот состав:

```json
{"sub": "…", "login": "…", "email": "…|null",
 "email_verified": true, "display_name": "…|null", "role": "…"}
```

`email_verified` — обязателен: портал кладёт email в свою сессию **только** при
`true` (анти-захват: неподтверждённый адрес не показываем и не храним). Без
этого флага портал не отличил бы «адреса нет» от «адрес не подтверждён».

**Сессия** (`session`) — описание cookie, которую портал ставит как есть:

```json
{"name": "setka_session", "value": "<подписанный токен>",
 "domain": ".xn--80adkdyec4j.xn--p1ai", "path": "/",
 "secure": true, "max_age": 2592000}
```

`value` — **тот же** токен, который ЕСА кладёт в cookie при входе (его можно
разобрать тем же кодом `verify_session_token`), иначе портал не «подхватит»
ВК-вход. Имя и домен — из env (`ESA_SESSION_COOKIE`,
`ESA_SESSION_COOKIE_DOMAIN`), `max_age` — из TTL сессии (30 дней).

---

## Публичные страницы и OIDC-эндпоинты

| Путь | Назначение |
|---|---|
| `GET /` | страница входа (`login.html`) |
| `GET /login` | тот же адрес (совместимость с клиентами, строящими `{issuer}/login?next=…`) |
| `GET /services` | каталог сервисов (`services.html`) |
| `GET /api/health` | `{"ok": true}` |
| `GET /.well-known/openid-configuration` | discovery |
| `GET /.well-known/jwks.json` | публичные ключи (RS256) |
| `GET /oidc/authorize` | вход в code-flow |
| `POST /oidc/token` | обмен кода / refresh |
| `GET /oidc/userinfo` | claims по Bearer access-токену |
| `GET|POST /oidc/logout` | RP-initiated logout |
| `GET /auth/vk/login`, `GET /auth/vk/callback` | вход через ВКонтакте |
| `GET /static/…` | bootstrap и иконки (отдаёт сам сервис) |

Семантика OIDC (коды ошибок, редиректы, HTTP-статусы) — **как в Сарафане**:
существующие клиенты (trener, Сабантуй, Казанская, портал) продолжают работать
без правок.

CORS **не включён** — внутренний API только с loopback, публичные OIDC-эндпоинты
звут сервером-сервером.

### nginx (пример роутинга)

```nginx
# ЕСА живёт на своём хосте: вход.вмалмыже.рф
server {
    listen 443 ssl http2;
    server_name вход.вмалмыже.рф;

    location /static/ {
        proxy_pass http://127.0.0.1:8010;   # статику отдаёт сам сервис
    }

    location / {
        proxy_pass http://127.0.0.1:8010;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # ВАЖНО: /internal/* НЕ проксируем из интернета.
    # Если проксировать нужно — только с бокса и с заголовком-токеном:
    #
    # location /internal/ {
    #     proxy_pass http://127.0.0.1:8010;
    #     proxy_set_header X-ESA-Internal-Token "…";   # из env, не из репозитория
    # }
}
```

Портал (Next.js) на `вмалмыже.рф` ходит в ЕСА через `https://вход.вмалмыже.рф`
и сам ставит куку сессии в браузер (по описанию из `/internal/auth/login`).

---

## Rate-limit

В Сарафане лимиты считались Redis'ом (`GatewayQuota`). В ЕСА Redis'а нет,
поэтому лимитер свой, **in-process** (`app/rate_limit.py`): fixed-window по IP,
30 запросов в минуту и 2000 в сутки на окна `authorize`, `token`, `vk-login`,
`vk-callback`, `logout`.

**Осознанное упрощение:** один процесс — один счётчик. При нескольких воркерах
uvicorn лимит умножается на число воркеров, при рестарте счётчики обнуляются.
Для входа посетителей (люди, не боты) этого достаточно; при горизонтальном
масштабировании счётчик нужно увезти в Redis.

---

## Логи

- обычные логи сервиса — `INFO` и выше (уровень — `ESA_LOG_LEVEL`);
- **audit-логгер `esa.audit`** — отдельным потоком: выдача кода, обмен кода,
  reuse-детект (код и refresh), logout, вход/регистрация через внутренний API.

Формат строки: `2026-11-28 00:02:51 AUDIT esa.audit authorize: code issued client=… sub=… scope=…`.

---

## Тесты

```bash
cd esa
.\.venv\Scripts\python.exe -m pytest -q
```

Тесты идут на **SQLite + aiosqlite** (внешних сервисов нет): Postgres не нужен,
Redis не нужен, RS256-ключ генерируется на лету. Покрыто: PKCE (S256
обязателен для public-клиента), одноразовость и TTL кода, точное совпадение
`redirect_uri`, scope, ротация refresh и reuse-detection с отзывом family,
`auth_time` (не подставляется, если время входа неизвестно), `prompt`/`max_age`,
пароли и резерв логинов владельца, сессионный токен, внутренний API (вход,
регистрация, инвайт, `/me`, `/services`, 404 для не-loopback), страницы и
статика.

---

## Что осталось за рамками этой задачи

- **Условия услуг в каталоге.** Источник условий (`modules/service_conditions.py`)
  остался в Сарафане. Страница `/services` работает и без них: роут отдаёт
  пустой `condition_cards`, шаблон просто ничего не рисует. Когда источник
  переедет — подключается в `app/routes/pages.py::build_condition_cards`.
- **Портальная часть** (страницы Next.js, nginx, деплой) — делает другой агент.
- **Миграция данных** (дамп `--data-only` с боевой базы Сарафана) — делает
  владелец; команда создания схемы готова.
- **Переключение клиентов на новый issuer** — issuer-строка не менялась, спец
  клиентов править не нужно.

## Известные ограничения

- Лимитер — в памяти процесса (см. «Rate-limit»).
- `create_all` не создаёт внешние объекты Postgres (extension'ы, Functions) —
  они не нужны сервису.
- Секрет сессии при отсутствии `ESA_WEB_SECRET` — ephemeral: после рестарта все
  сессии недействительны (на проде секрет обязателен).
- ВК-вход требует `ESA_VK_APP_ID`; без него `/auth/vk/login` отвечает 503.
