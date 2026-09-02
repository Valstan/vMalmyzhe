import { afterEach, describe, expect, it } from 'vitest'

import { buildRedirectUri, getEsaConfig, normalizeUrl } from './esa'

// Строка, зарегистрированная у Сарафана и отправленная ему письмом
// (mailbox/to-brain/2026-09-02-esa-redirect-uri-exact-string.md). Меняется
// только вместе с перерегистрацией клиента.
const EXACT = 'https://xn--80adkdyec4j.xn--p1ai/api/auth/callback'

describe('buildRedirectUri — байт в байт', () => {
  it('кириллический SERVER_URL даёт punycode-строку (G133)', () => {
    expect(buildRedirectUri('https://вмалмыже.рф')).toBe(EXACT)
  })

  it('punycode SERVER_URL даёт ту же строку', () => {
    expect(buildRedirectUri('https://xn--80adkdyec4j.xn--p1ai')).toBe(EXACT)
  })

  it('хвостовой слэш и регистр хоста не меняют результат', () => {
    expect(buildRedirectUri('https://вмалмыже.рф/')).toBe(EXACT)
    expect(buildRedirectUri('HTTPS://XN--80ADKDYEC4J.XN--P1AI')).toBe(EXACT)
  })

  it('локальный dev-URL с портом сохраняет порт', () => {
    expect(buildRedirectUri('http://localhost:3004')).toBe(
      'http://localhost:3004/api/auth/callback',
    )
  })

  it('пусто и мусор → null', () => {
    expect(buildRedirectUri('')).toBeNull()
    expect(buildRedirectUri('not a url')).toBeNull()
  })
})

describe('normalizeUrl', () => {
  it('корень без хвостового слэша, путь как есть', () => {
    expect(normalizeUrl('https://вход.вмалмыже.рф/')).toBe(
      'https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai',
    )
    expect(normalizeUrl('https://h.example/a/b/')).toBe('https://h.example/a/b/')
  })

  it('query и fragment в redirect_uri недопустимы', () => {
    expect(normalizeUrl('https://h.example/cb?x=1')).toBeNull()
    expect(normalizeUrl('https://h.example/cb#f')).toBeNull()
  })
})

describe('getEsaConfig', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('без секрета — null (портал живёт без входа)', () => {
    delete process.env.ESA_CLIENT_SECRET_PORTAL
    expect(getEsaConfig()).toBeNull()
  })

  it('с секретом — дефолты: issuer punycode, client_id portal, redirect из SERVER_URL', () => {
    process.env.ESA_CLIENT_SECRET_PORTAL = 'x'
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://вмалмыже.рф'
    delete process.env.ESA_ISSUER_URL
    delete process.env.ESA_CLIENT_ID
    delete process.env.ESA_REDIRECT_URI
    expect(getEsaConfig()).toEqual({
      issuer: 'https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai',
      clientId: 'portal',
      clientSecret: 'x',
      redirectUri: EXACT,
    })
  })

  it('ESA_REDIRECT_URI переопределяет, но тоже нормализуется', () => {
    process.env.ESA_CLIENT_SECRET_PORTAL = 'x'
    process.env.ESA_REDIRECT_URI = 'https://вмалмыже.рф/auth/esa/callback'
    expect(getEsaConfig()?.redirectUri).toBe(
      'https://xn--80adkdyec4j.xn--p1ai/auth/esa/callback',
    )
  })
})
