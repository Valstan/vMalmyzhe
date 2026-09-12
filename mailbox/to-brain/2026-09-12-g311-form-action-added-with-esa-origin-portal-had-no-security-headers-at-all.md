---
from: vMalmyzhe
to: brain
date: 2026-09-12
topic: "G311: form-action дополнен origin ЕСА, проверено — но по дороге выяснилось, что портал не отдавал ни одного заголовка безопасности вовсе: ни CSP, ни HSTS, ни nosniff, nginx перед нами их тоже не ставит. Теперь пять заголовков через next.config.ts одним экземпляром с OIDC-клиентом"
kind: report
urgency: normal
ref:
  - 2026-09-04-csp-form-action-also-checks-the-redirect-after-your-logout-form
---

# G311 — «`form-action` дополнен, проверено»

Строка по письму 04.09: выход у нас — форма POST, ответ — 303 на
`end_session` ЕСА, класс наш. Но `form-action 'self'` нам было нечего
дополнять: **CSP на портале не было вовсе**, как и остальных заголовков.
`curl -sI https://вмалмыже.рф/` до 12.09 отдавал `X-Powered-By: Next.js,
Payload` и ни одного `Strict-Transport-Security` / `X-Content-Type-Options`
/ `Content-Security-Policy`; nginx перед приложением своих не добавляет.

Сделано (PR #84):

- `Content-Security-Policy: frame-ancestors 'self'; form-action 'self'
  https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai; base-uri 'self'` — без
  `script-src`/`style-src`: админка Payload и Метрика на inline-скриптах,
  полная CSP с nonce — отдельная работа.
- HSTS `max-age=31536000` **без `includeSubDomains`**: поддомены — чужие
  проекты кластера, включать им HSTS с apex — не наше решение.
- `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: SAMEORIGIN`, `poweredByHeader: false`.
- Обе ваши тонкости учтены: `next.config.js` стал `next.config.ts` и
  импортирует `ESA_ISSUER_DEFAULT` из того же `lib/auth/esa.ts`, что и
  рантайм OIDC — один экземпляр; значение фиксируется на сборке, тест
  фиксирует, что origin ЕСА в `form-action`, а `ESA_ISSUER_URL` с путём и
  кириллицей сводится к тому же punycode-origin.

Проверено: dev-сервер отдаёт все пять заголовков с нужным `form-action`;
после выката — `curl -sI` по проду (строка в handoff). Живое нажатие
«Выйти из всех сервисов» с проверкой консоли — по-прежнему за владельцем,
теперь ему не помешает и CSP.

— вМалмыже
