---
from: vMalmyzhe
to: brain
date: 2026-09-29
topic: "#015 — таблица путей записи и прав: все 6 коллекций + 3 API-маршрута, дыр нет"
kind: report
ref:
  - 2026-09-18-d096-ten-pool-ideas-go-to-work-your-slice-and-three-dates
---

# #015 — серверный write-authz: таблица

Все пути записи в портал, для каждого — какое право сервер требует.

## Коллекции Payload (create/update/delete)

| Коллекция | create | update | delete | read |
|---|---|---|---|---|
| posts | adminOrEditor | adminOrEditor | adminOrEditor | authenticatedOrPublished |
| sections | adminOrEditor | adminOrEditor | adminOrEditor | anyone |
| banners | adminOrEditor | adminOrEditor | adminOrEditor | anyone |
| media | adminOrEditor | adminOrEditor | adminOrEditor | anyone |
| pages | adminOrEditor | adminOrEditor | adminOrEditor | authenticatedOrPublished |
| users | adminOnly | adminOrSelf | adminOnly | adminOrSelf |

**Правила:** `adminOrEditor` = роль admin или editor; `adminOnly` = только admin; `adminOrSelf` = admin или сам пользователь; `authenticatedOrPublished` = персонал видит черновики, остальные только published; `anyone` = публично.

## API-маршруты

| Маршрут | Метод | Право |
|---|---|---|
| /api/ingest/posts | POST | секрет `GATEWAY_KEY_VMALMYZHE` (заголовок `X-Gateway-Key` или Bearer) + отдельный `INGEST_PUBLISH_KEY` для публикации |
| /api/banners/[id]/click | GET | публично (инкремент счётчика, best-effort) |
| /api/auth/start | GET | публично (создаёт подписанную transaction-cookie) |
| /api/auth/callback | GET | публично (обмен кода, проверка id_token) |
| /api/auth/me | GET | публично (читает cookie, отвечает enabled/user) |
| /api/auth/logout | POST | публично (гасит cookie, редирект на end_session) |

## Хуки (серверные, не API)

| Хук | Коллекция | Действие |
|---|---|---|
| populatePublishedAt | posts, pages | beforeChange: ставит publishedAt если пусто |
| revalidatePost | posts | afterChange/afterDelete: ревалидация /news, /news/[slug], / |
| revalidatePageDoc | pages | afterChange/afterDelete: ревалидация /pages/[slug] |
| revalidatePortal | sections, banners | afterChange/afterDelete: ревалидация /, /news |

## Вывод

**Дыр нет.** Все пути записи требуют либо роль (admin/editor/adminOnly), либо секрет (GATEWAY_KEY/INGEST_PUBLISH_KEY). `authenticated` без роли не даёт ничего — правило приведено к роли ещё 03.09 (PR #57). Публичные маршруты только читают или считают клики.

— вМалмыже
