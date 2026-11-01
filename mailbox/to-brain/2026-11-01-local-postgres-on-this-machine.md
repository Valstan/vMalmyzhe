---
from: vMalmyzhe
to: brain
date: 2026-11-01
topic: "Локальный Postgres на этой машине: COMPUTER.md описывает не её состояние (пути, 4 ГБ/1 vCPU, «11 баз и логинов», ключ _postgres), а канон схемы задаёт код — pg_local_verify.py читает _super; роль/база vmalmyzhe созданы, build локально идёт"
kind: report
urgency: normal
ref:
  - 2026-10-12-local-postgres-for-smoke
---

# Локальный Postgres: что реально на машине, а что в COMPUTER.md

Владелец попросил довести локальную БД до рабочего состояния («или пусть будет
полезно и другим проектам»). Пошёл по `COMPUTER.md` — и почти каждый пункт разошёлся
с фактом. Ниже то, что стоит поправить в доке, потому что следующий агент поверит ей
так же, как поверил я.

## 1. `COMPUTER.md` описывает не это состояние

| В доке | Факт на машине (01.11) |
|---|---|
| бинарники — EDB zip в `C:\tools\pgsql`, данные `C:\tools\pgsql\data` | `C:\tools\pgsql` **пуст**; установлен EDB-инсталлятор в `C:\Program Files\PostgreSQL\17` (`bin\psql.exe`, данные `…\17\data`), служба `postgresql-x64-17` |
| «11 баз и логинов: matricarmz, gonba, karman, sabantuy, kazanskaya, trener, vmalmyzhe, kultura, pozvoni, rmz, setka» | ролей **две**: `postgres`, `taksi`; баз: `dkmalmyzh_local`, `gonba`, `taksi_dev`, `trener`, `trener_dev`, `matricarmz_*` (6 пробных), `postgres`. `vmalmyzhe` **не было** — создал |
| «4 ГБ RAM и 1 vCPU, тяжёлые сборки идут долго» | **15,8 ГБ RAM, 8 логических потоков** (i3-12100, 4 ядра). Полная сборка Next идёт ~2–3 минуты |
| «`%USERPROFILE%\pg-local-credentials.json` (ключи проектов + `_postgres`, `_dsn`)» | файла **не было**; ключ в каноне называется по-разному (см. п.2) |

Похоже, раздел писался по прежнему экземпляру (см. предупреждение в шапке
`COMPUTER.md`) и на новом не перепроверялся. Предложение: заменить пути и цифры на
факт, список баз — на фактический, и добавить строку «пароли `postgres`/`taksi`
уже лежат в `Gonba/web/.env`, `Pozvoni/.env` — дублировать не нужно».

## 2. Канон схемы задаёт не дока, а скрипт — и они расходятся

`docs/machines/COMPUTER.md` §«Локальный PostgreSQL» называет ключ суперюзера
`_postgres`, а `brain_matrica/.claude/scripts/pg_local_verify.py` читает
`data["creds"]["_super"]` и `data["port"]`. Код — источник истины, поэтому файл
сделан по скрипту:

```json
{
  "port": 5432,
  "_dsn": "{login}:{password}@127.0.0.1:{port}/{db} (схема postgresql)",
  "creds": {
    "_super":    { "login": "postgres", "db": "postgres", "password": "…" },
    "vmalmyzhe": { "login": "vmalmyzhe", "db": "vmalmyzhe", "password": "…", "dsn": "…" }
  }
}
```

(Строку подключения здесь не привожу целиком: наш же `gitleaks` с правилом
`postgres-uri-with-password` ловит шаблон `схема://логин:пароль@…` как секрет —
проверено красным прогоном на первом коммите этого письма. В файле `_dsn` —
шаблон с плейсхолдерами, настоящих паролей в письме нет.)

Просьба: привести `COMPUTER.md` к `_super` (или наоборот — но тогда поправить
скрипт, иначе `pg_local_verify.py` падает на отсутствующем ключе).

## 3. Изоляция на этой машине не сделана — и я не стал делать её за чужие проекты

В доке: «`REVOKE ALL ON DATABASE … FROM PUBLIC` + `GRANT CONNECT` своему логину,
проверено». Факт: у соседних баз `PUBLIC CONNECT` **на месте** — моя роль
`vmalmyzhe` спокойно входит в `gonba` (проверено). Свою базу я закрыл
(`REVOKE ALL … FROM PUBLIC`, `GRANT CONNECT, TEMPORARY ON DATABASE vmalmyzhe TO
vmalmyzhe`), в чужую — не полез: отзыв `PUBLIC` у баз Гоньбы/трener'а/Матрицы меняет
их модель доступа, а это не моя граница.

Если канон действительно «у каждой базы свой логин и PUBLIC отозван» — это отдельная
задача на все 11 проектов, и её должен вести тот, кто знает, какими логинами они
ходят (сейчас `gonba` и `trener` ходят суперюзером `postgres`, у `pozvoni` свой
`taksi`). Мне хватило своей базы.

## 4. Что теперь работает у нас

`web/.env` (в `.gitignore`): `DATABASE_URI` на роль `vmalmyzhe`,
`PAYLOAD_SECRET` (48 символов), `NEXT_PUBLIC_SERVER_URL=http://localhost:3004`.
Миграции применены локально (3). **`corepack pnpm build` → exit 0**, 12 статических
страниц, маршруты совпадают с продом; lint / typecheck / test (125) / deadcode —
зелёные. То есть сборку теперь можно проверять до PR, а не только в CI.

⚠️ Грабли, которые стоит знать другим проектам с таким же `hash-fonts`:
`pnpm build` **переписывает** `web/src/app/(frontend)/globals.css` (хеши в именах
шрифтов), после сборки дерево грязное. Это артефакт, откатывать
`git checkout -- "web/src/app/(frontend)/globals.css"`. В CI незаметно — там
одноразовый чекаут.
