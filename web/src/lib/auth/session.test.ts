import { describe, expect, it } from 'vitest'

import {
  SESSION_COOKIE,
  SESSION_COOKIE_ATTRS,
  SESSION_COOKIE_LEGACY,
  SESSION_MAX_AGE_S,
  openSession,
  publicProfile,
  readSessionCookie,
  sealSession,
  sessionFromClaims,
} from './session'

const SECRET = 'test-secret'
const NOW = 1_700_000_000

describe('sessionFromClaims', () => {
  it('подтверждённый email сохраняется, срок = now + max-age', () => {
    expect(
      sessionFromClaims({ sub: '1', email: 'a@b.ru', emailVerified: true, name: 'Иван' }, NOW),
    ).toEqual({ sub: '1', email: 'a@b.ru', name: 'Иван', exp: NOW + SESSION_MAX_AGE_S })
  })
  it('неподтверждённый email не хранится (анти-захват + минимизация)', () => {
    expect(
      sessionFromClaims({ sub: '1', email: 'a@b.ru', emailVerified: false, name: null }, NOW)
        .email,
    ).toBeNull()
  })
})

describe('sealSession / openSession', () => {
  const s = { sub: '1', email: 'a@b.ru', name: 'Иван', exp: NOW + 100 }
  it('круг', () => {
    expect(openSession(sealSession(s, SECRET), SECRET, NOW)).toEqual(s)
  })
  it('истёкшая → null, даже с верной подписью', () => {
    expect(openSession(sealSession(s, SECRET), SECRET, NOW + 100)).toBeNull()
  })
  it('нет cookie / чужой секрет / без sub → null', () => {
    expect(openSession(undefined, SECRET, NOW)).toBeNull()
    expect(openSession(sealSession(s, 'x'), SECRET, NOW)).toBeNull()
    expect(openSession(sealSession({ ...s, sub: '' }, SECRET), SECRET, NOW)).toBeNull()
  })
})

describe('publicProfile — без sub и exp', () => {
  it('имя есть', () => {
    expect(publicProfile({ sub: '1', email: 'a@b.ru', name: 'Иван', exp: 1 })).toEqual({
      name: 'Иван',
      email: 'a@b.ru',
    })
  })
  it('имени нет — локальная часть email; нет и его — «Житель»', () => {
    expect(publicProfile({ sub: '1', email: 'a@b.ru', name: null, exp: 1 }).name).toBe('a')
    expect(publicProfile({ sub: '1', email: null, name: null, exp: 1 }).name).toBe('Житель')
  })
})

describe('имя cookie — __Host- (#285)', () => {
  it('новое имя с префиксом; атрибуты, без которых браузер префикс отвергнет', () => {
    expect(SESSION_COOKIE).toBe('__Host-vm_resident')
    expect(SESSION_COOKIE_LEGACY).toBe('vm_resident')
    expect(SESSION_COOKIE_ATTRS).toMatchObject({ secure: true, path: '/', httpOnly: true })
    expect('domain' in SESSION_COOKIE_ATTRS).toBe(false)
  })
  it('читаем оба имени, новое в приоритете', () => {
    const jar = (j: Record<string, string>) => (n: string) => j[n]
    expect(readSessionCookie(jar({ [SESSION_COOKIE]: 'new', [SESSION_COOKIE_LEGACY]: 'old' }))).toBe('new')
    expect(readSessionCookie(jar({ [SESSION_COOKIE_LEGACY]: 'old' }))).toBe('old')
    expect(readSessionCookie(jar({}))).toBeUndefined()
  })
})
