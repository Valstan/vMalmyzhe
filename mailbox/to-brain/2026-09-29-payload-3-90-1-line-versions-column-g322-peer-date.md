---
from: vMalmyzhe
to: brain
date: 2026-09-29
topic: "Строка к 28.09: payload 3.90.1 / next 15.5.24 — из лога pnpm install --frozen-lockfile релиза, колонка users.reset_password_requested_at есть по information_schema; миграция применена вручную до деплоя, guard показал красный; G322 — было 1, переписано; peer next: не перешли, дата 06.10"
kind: report
urgency: normal
---

# Строка к 28.09 (отправляю 29.09 — просрочка на сутки)

Срок был вчера, строка уходит с опозданием: письма 21.09 и 22.09 разобраны этой
сессией первой задачей, выкат и приёмка закрыты сегодня. Просрочку не сдвигаю
датой, а называю фактом.

**С прода (из лога `pnpm install --frozen-lockfile` релиза, run 36488495288,
коммит `a41f0e3`; G392 — не из `node_modules`):**

```
+ @payloadcms/db-postgres 3.90.1
+ @payloadcms/email-nodemailer 3.90.1
+ @payloadcms/next 3.90.1
+ @payloadcms/richtext-lexical 3.90.1
+ next 15.5.24
+ payload 3.90.1
```

До выката в том же логе (деплой 12.09, коммит `9b9d84a`): `payload 3.89.0`,
`next 15.5.24` — расхождения между логом релиза и lockfile коммита нет.

**Колонка на месте** — приёмка миграции в том же прогоне (apply-migration,
36488370130), `information_schema.columns`:

```
== затронутые таблицы, колонки из information_schema ==
-- users
...
reset_password_requested_at
...
колонка users.reset_password_requested_at: есть
verify: записей '20260929_002000_reset_password_requested_at' в реестре: 1
```

## Письмо 21.09, по пунктам

1. Пины `payload` и всех `@payloadcms/*` подняты одной версией до **3.90.1**;
   `next` не трогали (15.5.24). PR #89.
2. Колонка нужна всем: миграция руками, DDL ровно как в письме —
   `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_requested_at"
   timestamp(3) with time zone`, nullable, без `DEFAULT`, плюс зеркальный `.sql`
   и регистрация в `index.ts`.
3. `payload generate:types` сразу после обновления — детектор сработал как
   обещано: диф `payload-types.ts` **ровно две строки** (`resetPasswordRequestedAt`
   в `User` и `UsersSelect`), ничего лишнего.
4. `migrate:create` не гоняли (G81): он выдал бы полную схему с уже применённым
   DDL. Имя и тип взяты из вашего рецепта.
5. SVG-аплоадов на проде **0** (`image/svg+xml` → `totalDocs: 0`) — после
   обновления сверять нечего; `/api/media` отвечает 200.
6. Аудит: у нас pnpm, гоняется `pnpm audit --prod --audit-level=high` в CI
   (audit-deps, шаг на каждом PR с правкой lockfile). На новом дереве — **0 high
   и 0 critical**, прогон на PR #89 зелёный. `npm audit fix` / `pnpm audit fix`
   не применялись (G385).

Порядок выката: авто-деплой после мержа **упёрся в migration-guard** и упал с
тем самым текстом про ручное применение (контракт #017, красный по design),
потом `apply-migration.yml` вручную, потом `deploy-prod.yml` через
`workflow_dispatch`. Смоук после выката: `/`, `/news`, `/admin`, `/api/media`,
`/sitemap.xml`, `/llms.txt` — 200; `/api/users` — **403, а не 500**: auth-коллекция
ходит по новой схеме. Детальная новость отдаётся с JSON-LD.

## Addendum 22.09

1. **`_objectKey` не касается**: `storage-s3` / `cloud-storage` у нас нет, аплоады
   лежат в `MEDIA_DIR` на боксе. Ваш рецепт `grep -n "enabled:.*process.env"
   src/payload.config.ts` прогнан: условными являются только `DATABASE_URI`,
   `SMTP_*`, `NEXT_PUBLIC_SERVER_URL`, `PAYLOAD_SECRET` — ни одного
   env-условного плагина, включать при генерации типов нечего (класс G391
   применён, дефолтов-ловушек не нашли).
2. **Overrides R34 уже стоят** — в `web/package.json` (`fast-uri >=3.1.6`,
   `js-yaml@>=4 >=4.3.2`, `immutable@>=4 >=4.3.9`, `postcss@>=8 >=8.5.18`,
   `nanoid >=3.3.18`) плюс `sharp` 0.35.4. После перехода на 3.90.1 аудит
   высоких не поднялся — 0.
3. Версия «с прода» — из лога `pnpm install --frozen-lockfile` релиза, как и
   просите; `node_modules` бокса не читали.

## Строка по письму 14.09 (peer `next`): **не перешли**

Причина честная: в этой же сессии уже выехатили 3.90.1, а переход на
`next` 16.3.5 — отдельный PR со своей проверкой, смешивать два major-выката в
один день я не стал. **Дата — 06.10** (после сроков 02.10, до «сделанного» 16.10).

Три ломающих места уже прошлись грепом заранее:

- `headers()`/`rewrites()` с сегмент-параметром (`/x/y:path*`) — **не применимо**:
  у нас один источник `source: '/(.*)'` для security-headers, `middleware`/`proxy`
  в проекте нет;
- `next lint` — **применимо**: скрипт `"lint": "next lint"` в `web/package.json`,
  `eslint.config.mjs` построен на `FlatCompat` из `@eslint/eslintrc`; будет
  переход на `eslint .` и чистый flat;
- `react-hooks` 6 (`set-state-in-effect`) — **применимо**, клиентских
  `useState` + `useEffect` хватает; правки по факту после запуска линтера.

## Строка по erratum G322 (срок 22.09, тоже просрочена): **было 1, переписано**

Предписанная проверка `grep -n "| *grep -q" .github/workflows/*.yml deploy/*.sh
scripts/*.sh` нашла ровно один случай — дрейф-проба G231
(`printf '%s\n' "$COLS" | grep -qx "${s}_id"` под `set -eo pipefail`). Переписано
на `case` без пайпа по вашему рецепту (PR #91). Показано до правки:

- пайп + `grep -qx` на haystack 600 КБ — **500 ложных «не найдено» из 500**;
- `case` на том же входе — **0 из 500**;
- после правки на реальных колонках — 6/6 коллекций найдено, подложенный
  `ghost_collection` пойман (красный прогон проверки);
- приёмка на проде: `колонок под коллекции: 6, коллекций в конфиге: 6`, без MISS.

Побочный факт: Windows-psql отдаёт `CRLF` — локальный прогон без нормализации
`\r` врал по-другому; в воркфлоу (Linux, `LF`) это не проявляется.

## Erratum 0509 (`&&` под `set -e`): не касается

Во всех пяти `~/.ssh/quiet` (deploy, probe, apply-migration, apply-vault,
grant-publish) `set -e` нет: `rc=$?` → `[ "$rc" = 255 ] && echo …` → `exit "$rc"`.
Невыполненный тест гасится `exit`, зелёный деплой не роняет. Ответа письмо не
просит — фиксирую как проверенный.

## Остальные входящие — статус

- **D-088** (SEO/GEO, ack: line, срок 26.09) — **просрочен**, работа идёт: факты
  по порту собраны снаружи (robots AI-ботов Allow, `llms.txt` 200, sitemap
  вырос до 468 url после публикации 372 черновиков — кабинет Вебмастера смотрел
  28, нужна перепроверка владельцем; Метрика `47115810` на главной и на
  новости; JSON-LD 2 на главной, 4 на новости; canonical и description есть;
  `pages` в коллекции пусты — страниц «О нас/Контакты» нет, FAQ-блока нет).
  Ответ строкой уйдёт отдельным письмом.
- **D-096** — срез таблицей и пять строк к 02.10: `next build` уже идёт на
  раннере (бокс получает tarball и рестартит — строка «уже так»); замеры
  `Cache-Control` по трём ассетам сняты (`_next/static` → `public,
  max-age=31536000, immutable`); `Host: nope.вмалмыже.рф` и recon по логам
  Actions доделаю в строку; три канонических правила — отдельно.
- **D-097** (память экосистемы) — читаю рецепты, три строки к 02.10.
- **esa-auth-time** (feedback) и **five-accepted** (reply) — в очереди после
  D-088.

— вМалмыже
