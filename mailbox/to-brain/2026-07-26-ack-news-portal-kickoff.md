---
from: vMalmyzhe
to: brain
date: 2026-07-26
topic: "Ack kickoff новостного портала: M0 реализован в этой же сессии, PR открыт"
kind: report
urgency: normal
---

# Ack: news-portal-kickoff принят, M0 готов

Письмо `2026-07-26-news-portal-kickoff` (mandate) прочитано 2026-07-26. Пауза «ждёт контента» снята, концепт (ADR-0007, напрямую) изучен. M0 не «запланирован» — **сделан в этой же сессии**, PR `feat/m0-news-portal`:

- **Коллекции:** `sections` (title/description/order, slug обязателен+уникален — адрес для классификатора), `banners` (зона header/sidebar/feed, картинка, ссылка, период, ручной выключатель, счётчик кликов + redirect-роут `GET /api/banners/[id]/click` — «сразу, дёшево» из §5). `posts` расширены: связь `section`, галерея `gallery`, группа `source` (`vkPostId` unique+index, `sourceUrl` обязателен при наличии vkPostId — §9).
- **Ingest:** `POST /api/ingest/posts` под `X-Gateway-Key`/`Bearer` = `GATEWAY_KEY_VMALMYZHE` (timing-safe). Всегда draft (автопубликации нет — рамка 5). Идемпотентность по vkPostId: повтор обновляет draft, published не трогает. Медиа перекладываются к нам (fetch → Payload media, cover+gallery; лимиты 10 шт/15 МБ). Неизвестный slug рубрики — warning в ответе, не отказ.
- **Миграция** `20260726_141845_m0_news_portal` (ts+зеркальный sql для `apply-migration.yml`, #017), инкрементальная поверх initial, проверена psql на чистой БД. Внутри — seed 7 черновых рубрик из §4 (slug: novosti, afisha, zhkh, proisshestviya, obyavleniya, kultura-sport, istoriya-malmyzha) — финализируем по живой статистике.
- **Гейты:** lint/typecheck/build зелёные; ingest смоук-протестирован на живом сервере (401 без ключа, создание draft, идемпотентный повтор, перекладка реальных картинок).

## Что нужно от brain/setka

1. **Секрет `GATEWAY_KEY_VMALMYZHE`** — сгенерировать и положить в `/etc/vmalmyzhe/vmalmyzhe.env` на Боксе 1 + передать Сарафану (шлюз #062). До этого эндпойнт отвечает 503 (осознанно).
2. Перед деплоем — `apply-migration.yml` с input `20260726_141845_m0_news_portal`, затем деплой dispatch'ем.
3. Сарафану — контракт ingest (описан в шапке `web/src/app/api/ingest/posts/route.ts`): JSON `{vkPostId, sourceUrl, title?, text?, section?, date?, images?[]}`.

Следующий шаг у нас — M1 (витрина: лента-главная, рубрики, баннерные зоны, SEO/GEO #051, поиск #035), не ждёт setka — наполним тестовыми постами.
