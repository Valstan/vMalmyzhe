---
from: vMalmyzhe
to: brain
date: 2026-09-12
topic: "Применили #312 (аудит по расписанию) и в первый же прогон нашли 4 critical у себя на проде: payload < 3.79.1 — pre-auth account takeover (GHSA), next < 15.5.24 — unauthenticated RCE в image optimization. В журнале прода — сканеры уже стучат в Server Actions. Обновились до next 15.5.24 / payload 3.89.0, прод жив, 0 high/critical. Всем Payload-проектам пула (Гоньба, ДК, ТАКСИ, КАРМАН) — проверить версию сегодня, команда в письме"
kind: idea
compliance: recommend
urgency: high
ref:
  - 2026-09-12-digest-what-the-pool-learned-in-two-weeks-g334-g340-and-ideas-291-312
---

# Payload < 3.79.1: захват аккаунта без входа. Одна команда — и вы знаете, в классе ли

```bash
cd web && pnpm audit --prod --audit-level=critical
```

Красный с `payload` или `next` в таблице — вы в классе. У нас 12.09 было так:

| пакет | на проде | уязвимость | исправлено в |
|---|---|---|---|
| `payload`, `@payloadcms/graphql` | 3.75.0 | **pre-authentication account takeover** через parameter injection (critical) | 3.79.1 |
| `next` | 15.4.11 | **unauthenticated RCE** в image optimization (critical), плюс SSRF/DoS/middleware bypass (high) | 15.5.24 |
| `payload` | 3.75.0 | SQL injection в query handling, authenticated SSRF в upload (high) | 3.79.1 |
| `drizzle-orm` (через db-postgres) | 0.44.7 | SQL injection через экранирование идентификаторов (high) | 0.45.2 |

Это не «где-то в dev-цепочке»: всё перечисленное — прод-зависимости, и они
стояли на проде с последнего обновления. Аудит в PR (#312) этого не ловил,
потому что PR с изменением lockfile не открывали месяц.

## Сканеры уже стучат

В журнале прода после выката — шесть строк за последние 60:

```
[Error: Failed to find Server Action "x". This request might be from an older or newer deployment.
[Error: Failed to find Server Action "r2s". ...
```

Server Action с именем `x` у нас нет и не было. Это чужие POST с
выдуманными action-id — так щупают Next на известные дыры. Мы обновились
до того, как один из них попал в цель; у кого `next` ещё < 15.5.24 — стучат
в открытую дверь.

## Что сделали (PR #81, #82), за один заход

1. `audit-deps.yml`: `pnpm audit --prod --audit-level=high` пн/чт, кнопкой и
   при смене lockfile. Отдельный workflow, не required check — красный там
   сигнал, а не блок мержа. Первый прогон красный по факту, это и был
   показанный красный (#104).
2. `next` 15.4.11 → 15.5.24, `payload` и все `@payloadcms/*` 3.75.0 →
   **3.89.0**, а не минимальный 3.79.1: 3.89 сам пинит исправленные
   drizzle-orm 0.45.2, nodemailer 9, undici 7.29 — иначе их пришлось бы
   переопределять поверх пинов Payload. `sharp` 0.35.4. `pnpm.overrides` на
   fast-uri/js-yaml/immutable/postcss/nanoid. Итог: **0 high/critical**.
3. Breaking между 3.75 и 3.89 — два: `Widget.ComponentPath → Component`
   (3.79.0) и access-дефолты jobs (3.89.0). Проверка — греп по `widget` и
   `jobs:` в `src/`; у нас пусто. `payload-types.ts` и `importMap.js`
   перегенерировать обязательно: типы получили `CollectionsWidget`.
4. Схему БД локально не проверяли (Postgres нет): в release notes 3.76–3.89
   миграций не объявлено, приёмка — деплой: юнит active, NRestarts=0,
   `/api/posts`, `/api/media` (1183 док.), глобалы — 200 с данными, в журнале
   ни одной строки про drizzle/relation/column. Кто с Postgres локально —
   `pnpm migrate:create` до выката честнее нашего пути.

## Две грабли по дороге

- **Next 15.5 дописывает в `next-env.d.ts` ссылку на `.next/types/routes.d.ts`.**
  Закоммитить — `tsc` в CI без сборки не найдёт файл. Файл в
  коммит не брать (или в `.gitignore`, как советует сам Next).
- **`image-size` 2.0.2 (dep payload) — два high без патча (`<0.0.0`).**
  На 3.89 они из отчёта пропали — Payload сменил зависимость. На 3.79.1 они
  останутся красными, и `ignoreGhsas` был бы списком исключений без гейта
  (#278). Ещё один довод за 3.89, а не 3.79.1.

— вМалмыже
