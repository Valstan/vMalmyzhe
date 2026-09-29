// ── Общий источник без зависимостей: origin ЕСА + сборка CSP/заголовков ──
//
// Этот файл — plain ESM без единой зависимости, поэтому его импортируют оба мира:
//   - `next.config.js` (Node не умеет TS, а Next 16 не грузит next.config.ts
//     с импортами: компилятор отдаёт CJS `exports` в ESM-скоуп);
//   - `lib/auth/esa.ts` и `lib/securityHeaders.ts` (тонкие TS-обёртки ниже).
//
// Правило одного экземпляра (G311): origin ЕСА для CSP `form-action` и для
// рантайма — одна константа здесь. Два места, не импортирующие друг друга,
// однажды разойдутся — поэтому оба импортируют отсюда.

// Issuer ЕСА — вход.вмалмыже.рф. В коде только punycode (G133).
export const ESA_ISSUER_DEFAULT = 'https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai'

// WHATWG URL Node каноникализирует хост в punycode и приводит регистр.
// Хвостовой слэш снимаем только у корня, у пути не трогаем: redirect_uri
// у Сарафана сравнивается без нормализации.
export const normalizeUrl = (raw) => {
  try {
    const u = new URL(raw)
    if (u.search || u.hash) return null
    return u.pathname === '/' ? u.origin : u.origin + u.pathname
  } catch {
    return null
  }
}

/** @param {{ ESA_ISSUER_URL?: string }} [env] */
export const esaOriginForCsp = (env = { ESA_ISSUER_URL: process.env.ESA_ISSUER_URL }) => {
  const issuer = normalizeUrl(env.ESA_ISSUER_URL || ESA_ISSUER_DEFAULT) ?? ESA_ISSUER_DEFAULT
  return new URL(issuer).origin
}

export const buildContentSecurityPolicy = (esaOrigin) =>
  [
    // Кто вправе вставить нас в iframe: только мы сами (live preview админки).
    "frame-ancestors 'self'",
    // Куда вправе уйти форма и редирект после неё: мы и выход через ЕСА.
    `form-action 'self' ${esaOrigin}`,
    // <base href> подменять нельзя: с ним относительные пути уводятся куда угодно.
    "base-uri 'self'",
  ].join('; ')

/** @param {{ ESA_ISSUER_URL?: string }} [env] */
export const buildSecurityHeaders = (env = { ESA_ISSUER_URL: process.env.ESA_ISSUER_URL }) => [
  // Без includeSubDomains: поддомены вмалмыже.рф — чужие проекты кластера,
  // включать им HSTS с нашего apex — не наше решение.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(esaOriginForCsp(env)) },
]
