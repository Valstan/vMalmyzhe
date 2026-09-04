import { describe, expect, it } from 'vitest'

import type { EsaConfig } from './esa'
import {
  buildAuthorizeUrl,
  buildEndSessionUrl,
  extractClaims,
  open,
  openTransaction,
  pkceChallenge,
  randomToken,
  sanitizeNextPath,
  seal,
} from './oidc'

const SECRET = 'test-secret'
const cfg: EsaConfig = {
  issuer: 'https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai',
  clientId: 'portal',
  clientSecret: 's',
  redirectUri: 'https://xn--80adkdyec4j.xn--p1ai/api/auth/callback',
}
const discovery = {
  issuer: cfg.issuer,
  authorization_endpoint: `${cfg.issuer}/oidc/authorize`,
  token_endpoint: `${cfg.issuer}/oidc/token`,
  jwks_uri: `${cfg.issuer}/oidc/jwks`,
}

describe('pkceChallenge — RFC 7636 appendix B', () => {
  it('известный вектор', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
  it('randomToken — 43 символа base64url, разные', () => {
    const a = randomToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(randomToken()).not.toBe(a)
  })
})

describe('seal / open — подписанная cookie', () => {
  it('круг', () => {
    expect(open(seal({ a: 1 }, SECRET), SECRET)).toEqual({ a: 1 })
  })
  it('чужой секрет, подмена данных, мусор → null', () => {
    const s = seal({ a: 1 }, SECRET)
    expect(open(s, 'other')).toBeNull()
    const [data, sig] = s.split('.')
    const forged = Buffer.from(JSON.stringify({ a: 2 })).toString('base64url')
    expect(open(`${forged}.${sig}`, SECRET)).toBeNull()
    expect(open(`${data}.`, SECRET)).toBeNull()
    expect(open('', SECRET)).toBeNull()
    expect(open('nodot', SECRET)).toBeNull()
  })
})

describe('openTransaction', () => {
  const tx = { state: 's', nonce: 'n', verifier: 'v' }
  it('валидная транзакция', () => {
    expect(openTransaction(seal(tx, SECRET), SECRET)).toEqual(tx)
  })
  it('next: внутренний путь проходит, внешний отбрасывается молча', () => {
    expect(openTransaction(seal({ ...tx, next: '/news' }, SECRET), SECRET)).toEqual({
      ...tx,
      next: '/news',
    })
    expect(openTransaction(seal({ ...tx, next: '//evil' }, SECRET), SECRET)).toEqual(tx)
  })
  it('неполная транзакция → null', () => {
    expect(openTransaction(seal({ state: 's', nonce: 'n' }, SECRET), SECRET)).toBeNull()
    expect(openTransaction(seal({ ...tx, state: '' }, SECRET), SECRET)).toBeNull()
  })
})

describe('sanitizeNextPath — гард open-redirect', () => {
  it.each(['/news', '/news/section/afisha?x=1'])('ок: %s', (p) => {
    expect(sanitizeNextPath(p)).toBe(p)
  })
  it.each(['//evil.example', 'https://evil.example', '/', '', 'news', '/a\\b', null, undefined])(
    'null: %s',
    (p) => {
      expect(sanitizeNextPath(p)).toBeNull()
    },
  )
  it('слишком длинный → null', () => {
    expect(sanitizeNextPath('/' + 'a'.repeat(600))).toBeNull()
  })
})

describe('buildAuthorizeUrl', () => {
  it('все параметры контракта, redirect_uri байт в байт', () => {
    const u = new URL(buildAuthorizeUrl(cfg, discovery, { state: 'S', nonce: 'N', verifier: 'V' }))
    expect(u.origin + u.pathname).toBe(discovery.authorization_endpoint)
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('client_id')).toBe('portal')
    expect(u.searchParams.get('redirect_uri')).toBe(cfg.redirectUri)
    expect(u.searchParams.get('scope')).toBe('openid profile email')
    expect(u.searchParams.get('state')).toBe('S')
    expect(u.searchParams.get('nonce')).toBe('N')
    expect(u.searchParams.get('code_challenge')).toBe(pkceChallenge('V'))
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('buildEndSessionUrl — RP-initiated logout', () => {
  const withEndSession = { ...discovery, end_session_endpoint: `${cfg.issuer}/oidc/logout` }

  it('строка мандата: client_id + post_logout_redirect_uri в origin нашего redirect_uri', () => {
    const u = new URL(buildEndSessionUrl(cfg, withEndSession) as string)
    expect(u.origin + u.pathname).toBe(withEndSession.end_session_endpoint)
    expect(u.searchParams.get('client_id')).toBe('portal')
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://xn--80adkdyec4j.xn--p1ai/',
    )
  })

  it('возврат берётся из redirectUri, а не из хоста ЕСА', () => {
    const u = new URL(buildEndSessionUrl(cfg, withEndSession) as string)
    const back = new URL(u.searchParams.get('post_logout_redirect_uri') as string)
    expect(back.origin).toBe(new URL(cfg.redirectUri).origin)
    expect(back.origin).not.toBe(new URL(cfg.issuer).origin)
  })

  it('нет end_session_endpoint (старый деплой ЕСА) → null, выход деградирует до локального', () => {
    expect(buildEndSessionUrl(cfg, discovery)).toBeNull()
    expect(buildEndSessionUrl(cfg, { ...discovery, end_session_endpoint: '' })).toBeNull()
  })

  it('чужой origin в документе → null: «Выйти» не становится открытым редиректором', () => {
    expect(
      buildEndSessionUrl(cfg, { ...discovery, end_session_endpoint: 'https://evil.example/logout' }),
    ).toBeNull()
    expect(
      buildEndSessionUrl(cfg, { ...discovery, end_session_endpoint: `${cfg.issuer}:8443/logout` }),
    ).toBeNull()
  })

  it('битый адрес в документе → null, а не исключение', () => {
    expect(buildEndSessionUrl(cfg, { ...discovery, end_session_endpoint: '/oidc/logout' })).toBeNull()
    expect(buildEndSessionUrl(cfg, { ...discovery, end_session_endpoint: 'не-url' })).toBeNull()
  })
})

describe('extractClaims — минимизация', () => {
  it('нормальный набор', () => {
    expect(
      extractClaims({ sub: ' 42 ', email: ' A@B.RU ', email_verified: true, name: ' Иван ' }),
    ).toEqual({ sub: '42', email: 'a@b.ru', emailVerified: true, name: 'Иван' })
  })
  it('email без @ → null; email_verified не boolean true → false', () => {
    expect(extractClaims({ sub: '1', email: 'x', email_verified: 'true' })).toEqual({
      sub: '1',
      email: null,
      emailVerified: false,
      name: null,
    })
  })
  it('нет sub → ошибка', () => {
    expect(() => extractClaims({ email: 'a@b.ru' })).toThrow(/sub/)
  })
})
