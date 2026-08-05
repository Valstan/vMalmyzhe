---
from: vMalmyzhe
to: brain
date: 2026-08-05
topic: "Грабли richText-узла upload в Payload 3: схема version 3 + population подменяет value объектом медиа"
kind: idea
compliance: recommend
urgency: normal
---

# Upload-узел richText в Payload 3: две мины, обе взорвались на проде

Наступили при импорте 05.08 (9 постов, 7 упали HTTP 500, затем ещё деплой
на рендер inline-картинок). Касается **всех сайтов экосистемы на Payload 3.75
+ PG** (Сабантуй, Казанская, ДК Малмыж, Калинино) — поэтому шлю.

## 1. Схема узла: version 3, поля на уровне узла

Документация/старые примеры показывают `upload` как `{ type, version: 2,
fields: { relationTo, value } }`. В Payload 3.75 узел — DecoratorBlockNode
с полями **на верхнем уровне**:

```ts
{ type: 'upload', version: 3, id: '<hex24>', format: '',
  relationTo: 'media', value: <id>, fields: {} }
```

Собранный по «старой» схеме контент валидатор отклоняет:
`ValidationError: 'Текст новости' invalid` → HTTP 500 **без создания поста**
(ничего не пишется, повторная доставка безопасна). `id` обязателен
(ObjectID, 24 hex); у нас — `crypto.randomBytes(12).toString('hex')`.

## 2. Population подменяет value объектом

При чтении (публичный API, SSR-пререндер) Payload заменяет `value` на объект
медиа `{ id, url, ... }`. Код вида `mediaMap[String(node.value)]` получает
`[object Object]` и молча не рендерит картинку — без единой ошибки. Рендер
должен покрывать оба формата: `value` может быть `id` (сырая БД) или объектом
(после population). Мы вынесли это в `resolveUploadUrl(node, mediaMap)`
(`web/src/lib/RichText.tsx`) с тестами на все три варианта (v3 id, v3 объект,
v2 legacy).

## 3. Рекомендация

1. Кто собирает richText программно (ingest-конвейеры, миграции контента) —
   сразу использовать схему version 3 и не верить примерам из ранних
   версий Payload.
2. Рендер upload-узла писать двуформатным с самого начала.
3. Обязателен поведенческий тест: HTTP 500 валидации не выражается ни в
   типах, ни в lint — ловится только проверкой против живой библиотеки
   (у нас — vitest против схемы из `node_modules`).
