import { ESA_ISSUER_DEFAULT, normalizeUrl } from './auth/esa'

// ── Заголовки безопасности ────────────────────────────────────────────────────
//
// До 12.09 портал не отдавал ни одного: ни HSTS, ни nosniff, ни CSP (nginx
// перед нами их тоже не добавляет). Набор здесь нарочно консервативный —
// без `script-src`/`style-src`: админка Payload и счётчик Метрики живут на
// inline-скриптах, полная CSP — отдельная работа с nonce.
//
// `form-action` — G311 (письмо brain 04.09, источник ТАКСИ): CSP применяет
// его и к адресу РЕДИРЕКТА в ответ на отправку формы. Кнопка «Выйти из всех
// сервисов» — форма POST, ответ — 303 на `end_session` ЕСА. С `form-action
// 'self'` браузер режет этот редирект: своя сессия погашена, сессия ЕСА жива,
// ошибка только в консоли. Поэтому origin ЕСА — в списке, одним экземпляром
// с рантаймом (`ESA_ISSUER_DEFAULT`).
//
// Значение фиксируется на сборке (Next кладёт headers() в манифест маршрутов):
// `ESA_ISSUER_URL` читает CI, а не бокс. На проде переменная не задана —
// работает дефолт, тот же, что в рантайме.

// Узкий тип, не ProcessEnv: у проекта он объявлен строго, а тестам нужен пустой env.
export type CspEnv = { ESA_ISSUER_URL?: string }

export const esaOriginForCsp = (env: CspEnv = { ESA_ISSUER_URL: process.env.ESA_ISSUER_URL }): string => {
  const issuer = normalizeUrl(env.ESA_ISSUER_URL || ESA_ISSUER_DEFAULT) ?? ESA_ISSUER_DEFAULT
  return new URL(issuer).origin
}

export const buildContentSecurityPolicy = (esaOrigin: string): string =>
  [
    // Кто вправе вставить нас в iframe: только мы сами (live preview админки).
    "frame-ancestors 'self'",
    // Куда вправе уйти форма и редирект после неё: мы и выход через ЕСА.
    `form-action 'self' ${esaOrigin}`,
    // <base href> подменять нельзя: с ним относительные пути уводятся куда угодно.
    "base-uri 'self'",
  ].join('; ')

export const buildSecurityHeaders = (
  env: CspEnv = { ESA_ISSUER_URL: process.env.ESA_ISSUER_URL },
): Array<{ key: string; value: string }> => [
  // Без includeSubDomains: поддомены вмалмыже.рф — чужие проекты кластера,
  // включать им HSTS с нашего apex — не наше решение.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(esaOriginForCsp(env)) },
]
