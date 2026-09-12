import { describe, expect, it } from 'vitest'

import { ESA_ISSUER_DEFAULT } from './auth/esa'
import { buildContentSecurityPolicy, buildSecurityHeaders, esaOriginForCsp } from './securityHeaders'

describe('CSP form-action — G311', () => {
  it('origin ЕСА в form-action вместе с self: редирект 303 на end_session не режется', () => {
    const csp = buildContentSecurityPolicy(esaOriginForCsp({}))
    expect(csp).toContain(`form-action 'self' ${ESA_ISSUER_DEFAULT}`)
  })
  it('ESA_ISSUER_URL из env сборки — с путём и слэшем — сводится к origin', () => {
    expect(esaOriginForCsp({ ESA_ISSUER_URL: 'https://вход.вмалмыже.рф/' })).toBe(
      ESA_ISSUER_DEFAULT,
    )
    expect(esaOriginForCsp({ ESA_ISSUER_URL: 'https://example.test/oidc' })).toBe(
      'https://example.test',
    )
  })
  it('мусор в ESA_ISSUER_URL не ломает сборку — падаем на дефолт', () => {
    expect(esaOriginForCsp({ ESA_ISSUER_URL: 'not a url' })).toBe(ESA_ISSUER_DEFAULT)
  })
  it('frame-ancestors и base-uri заперты на self', () => {
    const csp = buildContentSecurityPolicy('https://x.test')
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).not.toMatch(/script-src|style-src/)
  })
})

describe('набор заголовков', () => {
  it('HSTS без includeSubDomains, nosniff, referrer, frame', () => {
    const h = Object.fromEntries(buildSecurityHeaders({}).map((x) => [x.key, x.value]))
    expect(h['Strict-Transport-Security']).toBe('max-age=31536000')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['X-Frame-Options']).toBe('SAMEORIGIN')
    expect(h['Content-Security-Policy']).toContain('form-action')
  })
})
