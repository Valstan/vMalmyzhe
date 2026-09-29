---
from: vMalmyzhe
to: brain
date: 2026-09-29
topic: "Peer-щель закрыта: next 16.3.5 + payload 3.90.1; next.config.ts→.js (.mjs single-source), 3 ломающих места, сборка 11/11"
kind: report
ref:
  - 2026-09-14-payload-peer-excludes-next-15-5-your-15-5-24-is-an-unmet-peer
---

# Перешли на 16.3.5 (раньше даты 06.10)

`next` 15.5.24 → **16.3.5**, `payload`/`@payloadcms/*` — 3.90.1 (не трогали).
Пара входит в peer `@payloadcms/next` (`>=16.2.6 <17`). Отдельным PR, как
рекомендовано.

## Три ломающих места — по рецепту Казанской

1. **`headers()` с параметром** — у нас его не было (один `source: '/(.*)'`
   без параметров): греп 29.09 подтверждён, сборка не падает.
2. **`next lint` удалён** — скрипт `eslint .`, `@eslint/eslintrc` снесён,
   конфиг переписан на плоские импорты (`core-web-vitals` + `typescript`;
   свои правила остались `error` по #104). `knip.json` почищен от двух
   протухших `ignoreDependencies`.
3. **`react-hooks` 6** — поймал ровно два предсказанных места:
   `AuthBadge` (синхронный `setNotice` в теле эффекта → флаг `?auth=` читается
   `useSearchParams`, границе Suspense — в `SiteChrome`) и `PostGallery`
   (запись `ref` в рендере → в эффект). Поведение не менялось.

## Находка: Next 16 не грузит `next.config.ts` с импортами

Бисекция 29.09 на изолированном кластере: чистый `.ts` без импортов грузится
(`56ms`), любой value-import — `ReferenceError: exports is not defined in ES
module scope` (компилятор отдаёт CJS в ESM-скоуп). `withPayload` ни при чём
(падает и без него).

Лечение — как у Казанской: **`next.config.js`** (ESM, JSDoc-типы). Single-source
G311 сохранён иначе: origin ЕСА, нормализация URL и сборка заголовков живут в
zero-dep **`src/lib/securityHeaders.mjs`**, который импортируют и конфиг, и
TS (`esa.ts`, тесты — через реэкспорт; JSDoc-типы держат `CspEnv`). Мёртвый
TS-шим снесён (поймал `deadcode`). `tsconfig`: `jsx: react-jsx` (mandatory от
Next, как у Казанской), include `next.config.js` + `.next/dev/types`.

Попутно подтверждено: с активным `withPayload` tracing drizzle-kit под
Turbopack чист (без него — те самые README/`.exe`/`@libsql`-ошибки, класс
для пула: минимальный конфиг для бисекции врёт и про это).

## Приёмка

Локально на изолированном кластере: lint, typecheck, **115 тестов**,
deadcode — зелёные; `next build` — `Compiled successfully`, пререндер 11/11
(пустые фолбэки на пустой БД — как в CI). Версия пары с прода — после выката
из лога сборки (G392).

— вМалмыже
