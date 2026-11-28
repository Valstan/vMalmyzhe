# Переезд ЕСА на вмалмыже.рф — порядок выкатки

> ЕСА (единая система авторизации экосистемы) с бокса Сарафана переезжает на
> бокс портала **вмалмыже.рф**: там она становится отдельным сервисом
> (`esa/`), а портал получает свои страницы `/login` и `/services`.
> Документ — порядок выкатки и откат; он же — объяснение «что где теперь».

## Что где после переезда

| Что | Где | Кто обслуживает |
|---|---|---|
| OIDC-провайдер (`/oidc/*`, `/.well-known/*`) | `https://вход.вмалмыже.рф` | сервис `esa` на боксе портала |
| Страница входа ЕСА (гостям других сервисов) | `https://вход.вмалмыже.рф/` | сервис `esa` |
| Вход на портале (логин/пароль, регистрация, ВК ID) | `https://вмалмыже.рф/login` | портал (Next.js) |
| Каталог сервисов экосистемы | `https://вмалмыже.рф/services` | портал, список — из сервиса `esa` |
| Каталог сервисов (старая ссылка) | `https://вход.вмалмыже.рф/services` | сервис `esa` |
| Внутренний API (`/internal/*`) | `127.0.0.1:8010` на боксе | только портал; наружу не отдаётся |

Адрес issuer'а **не меняется**: `https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai`.
Поэтому клиенты OIDC (Тренер, Сабантуй, Казанская, ПОЗВОНИ, КАРМАН, портал)
перерегистрировать не нужно — работают те же `client_id` и те же секреты,
переехавшие вместе с таблицей `oauth_clients`.

## Что нужно от владельца

1. ~~**Переключить домен `вход.вмалмыже.рф` на бокс портала.**~~ **Сделано
   28.11** (в панели Джино, силами агента — порядок ниже).
2. **Одноразовая установка на боксе:** `sudo apt install -y python3.12-venv`
   (на боксе нет `ensurepip`, а без него не создаётся venv с pip). **Сделано.**
3. **Ключ подписи RS256** — файл `radar_id_rs256.pem` перенесён с бокса
   Сарафана (он там лежал в `/etc/setka/`). Потеря ключа = перевыпуск для всей
   экосистемы, поэтому копия лежит и в комнате КАРМАНа.

## Как переключали домен (28.11) — чтобы повторить или откатить

**Схема TLS (важно, выяснилась на живом входе):** для этого домена TLS
терминирует **сам бокс** (nginx + certbot), а edge Джино пробрасывает SNI как
есть. Видно по сертификату, который видит посетитель: он выпущен на боксу
(`/etc/letsencrypt/live/xn--b1ae3a1a.../`), а не на edge. Поэтому сертификат
надо выпускать **на боксе**: сертификат панели Джино для этого домена edge не
отдаёт (SNI отклоняется, `unrecognized name`).

Порядок (панель Джино + бокс):

1. **Панель → Домены → вход.вмалмыже.рф → Основные настройки → Привязка
   домена → Изменить → VPS → контейнер «Гоньба» (это бокс портала) →
   Сохранить.** Прежде был «САРАФАН».
2. **Панель → Домены → вмалмыже.рф → DNS** — A-запись поддомена
   `xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai` → `92.51.22.114` (edge портала);
   та же правка в зоне самого домена (вход.вмалмыже.рф → DNS). Зона
   перезагружается Джино **не сразу** — до обновления авторитетные NS ещё
   отдают старый адрес (проверка: `nslookup <домен> ns1.jino.ru`).
3. **Бокс: выпустить сертификат.** DNS к этому моменту уже указывает на edge
   портала, edge отдаёт боксу запросы по http → проверка ACME проходит через
   `location /.well-known/acme-challenge/` в `deploy/nginx/esa.conf`:
   ```bash
   sudo mkdir -p /var/www/html/.well-known/acme-challenge
   sudo certbot certonly --webroot -w /var/www/html \
     -d xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai --non-interactive --agree-tos
   sudo install -m 755 deploy/certbot-reload-nginx.sh \
     /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
   ```
   ⚠️ `www.вход.вмалмыже.рф` в проверке ACME **не проходит** (edge его не
   маршрутизирует на бокс) — сертификат только на основной домен.
4. **Бокс: включить TLS-vhost** `deploy/nginx/esa-tls.conf` →
   `/etc/nginx/sites-enabled/esa-tls`, `nginx -t` и reload.
5. **Приёмка:** `https://вход.вмалмыже.рф/.well-known/openid-configuration` → 200,
   `/` → 200, `/services` → 200; TLS без ошибок; `/internal/*` снаружи → 404.

**Откат:** в панели вернуть привязку домена на VPS «САРАФАН» и A-записи на
`81.177.6.46`; на боксе — `sudo rm /etc/nginx/sites-enabled/esa-tls` и reload.
Сервис `esa` можно оставить работать: он ничего не ломает.

## Порядок выкатки

### 0. Подготовка (без остановки сервисов)

```bash
# на машине владельца: ветка с сервисом уже в main, выкатка — CI
# (workflow «Deploy ESA to production»), вручную: workflow_dispatch

# на боксе: база и роль сервиса
sudo -u postgres psql -c "CREATE ROLE esa_app LOGIN PASSWORD '<пароль>'"
sudo -u postgres psql -c "CREATE DATABASE esa OWNER esa_app"
```

### 1. Секреты сервиса (`/etc/esa/esa.env`, 600, root:valstan)

Имена переменных — с префиксом `ESA_` (сервис понимает и старые `RADAR_ID_*`
/ `SETKA_WEB_SECRET` — на случай, если кто-то поднимет его из старой
конфигурации, но в проде используем новые имена).

```
ESA_DATABASE_URL=postgresql+asyncpg://esa_app:<пароль>@127.0.0.1:5432/esa
ESA_WEB_SECRET=<из комнаты setka>      # подпись сессий и VK-состояния
ESA_SESSION_COOKIE=setka_session
ESA_SESSION_COOKIE_DOMAIN=.xn--80adkdyec4j.xn--p1ai
ESA_SESSION_COOKIE_SECURE=1
ESA_ISSUER=https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai
ESA_PRIVATE_KEY_FILE=/home/valstan/vmalmyzhe/esa/keys/radar_id_rs256.pem
ESA_VK_APP_ID=<из комнаты setka>
ESA_VK_REDIRECT_URI=https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai/auth/vk/callback
ESA_INTERNAL_TOKEN=<случайный, общий с порталом>
ESA_INVITE_CODE=                          # пусто = регистрация открыта
ESA_LOG_LEVEL=INFO
```

Ключ подписи кладётся файлом:

```bash
install -d -m 700 /home/valstan/vmalmyzhe/esa/keys
install -m 600 radar_id_rs256.pem /home/valstan/vmalmyzhe/esa/keys/radar_id_rs256.pem
```

### 2. Портал (prod-env `/etc/vmalmyzhe/vmalmyzhe.env`)

```
ESA_INTERNAL_URL=http://127.0.0.1:8010
ESA_INTERNAL_TOKEN=<тот же, что у сервиса>
ESA_PUBLIC_URL=https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai
ESA_SESSION_COOKIE_NAME=setka_session
```

### 3. Данные: аккаунты и клиенты

Переносятся две таблицы — `radar_users` (аккаунты посетителей) и
`oauth_clients` (регистр OIDC-клиентов). Важно: `radar_users.sub` — это
opaque-идентификатор, по которому соседние проекты (Казанская, ПОЗВОНИ)
узнают посетителя. Он переносится **как есть**, иначе профили разъедутся.

```bash
# на машине владельца (источник — локальная БД Сарафана)
pg_dump -h 127.0.0.1 -p 5433 -U setka -d sarafan \
  -t radar_users -t oauth_clients --data-only -f esa_seed.sql
scp esa_seed.sql GONBA:/tmp/
# на боксе
PGPASSWORD='<пароль>' psql -h 127.0.0.1 -U esa_app -d esa -f /tmp/esa_seed.sql
```

Схему создаёт сам сервис (`python -m app.init_db` либо автоматически при
старте) — поэтому дамп с `--data-only`.

### 4. Транспорт

```bash
sudo cp deploy/nginx/setka_maps.conf /etc/nginx/conf.d/setka_maps.conf
sudo cp deploy/nginx/esa.conf /etc/nginx/sites-enabled/esa
sudo nginx -t && sudo systemctl reload nginx
```

TLS-часть — отдельным файлом (сертификат выпускается на боксе, см. «Как
переключали домен»):

```bash
sudo cp deploy/nginx/esa-tls.conf /etc/nginx/sites-enabled/esa-tls
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Запуск сервиса

```bash
sudo cp deploy/esa.service /etc/systemd/system/esa.service   # с подстановками
sudo systemctl daemon-reload && sudo systemctl enable --now esa
sudo systemctl status esa
```

### 6. Переключение домена

**Сделано 28.11** — порядок действий в панели Джино и на боксе описан в
«Как переключали домен» выше. До переключения сервис работает, но по старому
адресу не виден.

### 7. Приёмка

```bash
# с бокса
curl -s http://127.0.0.1:8010/api/health
curl -s http://127.0.0.1:8010/.well-known/openid-configuration | head -c 400
# снаружи (после переключения домена)
curl -s https://вход.вмалмыже.рф/.well-known/openid-configuration | head -c 200
curl -s -o /dev/null -w '%{http_code}\n' https://вмалмыже.рф/services
# живой вход: портал /login → логин/пароль → сессия; ВК ID → round-trip
```

Живой вход по ВК и OIDC-раунд-трип клиента (Тренер/Сабантуй/Казанская) —
**руками владельца**: агент не может войти за человека.

## Откат

1. Домен `вход.вмалмыже.рф` — обратно на прежний origin (бокс Сарафана).
   Сервис на боксе портала можно оставить работать: он ничего не ломает.
2. Портал: `ESA_INTERNAL_URL` пустой → вход на портале отключается, сайт живёт
   (graceful-degrade, как сейчас без секрета ЕСА).
3. Данные: дамп `esa_seed.sql` остаётся на месте — восстановление обратно
   делается тем же pg_dump/pg_restore в обратную сторону.

## Чего сервис НЕ делает

* Не обслуживает операторские страницы Сарафана (дашборд, `/tokens`, `/ad`) —
  они остались на стенде Сарафана.
* Не обслуживает кабинет Радара (`радар.вмалмыже.рф`) — тот живёт в приложении
  Сарафана и на публичный адрес не выведен.
* Не отдаёт наружу `/internal/*` — только портал на том же боксе.
* Не хранит ПДн жителей: в сервисе только логин, хэш пароля, `sub`, имя и
  адрес (если он подтверждён). Факты о жителе хранит проект-владелец
  (D-178), права — КАРМАН.
