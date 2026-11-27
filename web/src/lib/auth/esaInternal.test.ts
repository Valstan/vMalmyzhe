import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  esaInternalUrl,
  esaLogin,
  esaMe,
  esaRegister,
  esaServices,
  esaSessionCookieName,
} from './esaInternal'

// Модуль читает process.env в момент вызова (прод — runtime standalone), поэтому
// окружение готовим на каждый тест, а не на импорт.

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const okUser = {
  sub: 'u-1',
  login: 'ivan',
  email: 'ivan@example.ru',
  email_verified: true,
  display_name: 'Иван',
  role: 'radar',
}

describe('конфигурация внутреннего API', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('без ESA_INTERNAL_URL внутренний API недоступен (дефолтов-адресов нет)', async () => {
    vi.stubEnv('ESA_INTERNAL_URL', '')
    vi.stubEnv('ESA_INTERNAL_TOKEN', 'tok')
    expect(esaInternalUrl()).toBeNull()
    const res = await esaLogin('ivan', 'password123')
    expect(res).toEqual({ ok: false, status: 0, code: 'unavailable' })
  })

  it('имя cookie сессии ЕСА задаётся env, по умолчанию — setka_session', () => {
    vi.stubEnv('ESA_SESSION_COOKIE_NAME', '')
    expect(esaSessionCookieName()).toBe('setka_session')
    vi.stubEnv('ESA_SESSION_COOKIE_NAME', 'other')
    expect(esaSessionCookieName()).toBe('other')
  })
})

describe('вход и регистрация', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('логин ходит на /internal/auth/login с общим токеном и разбором тела', async () => {
    vi.stubEnv('ESA_INTERNAL_URL', 'http://127.0.0.1:8010')
    vi.stubEnv('ESA_INTERNAL_TOKEN', 'shared')
    const fetchMock = vi.fn().mockResolvedValue(
      json({ ok: true, user: okUser, session: { name: 'setka_session', value: 'v', domain: null, path: '/', secure: true, max_age: 10 } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await esaLogin('ivan', 'password123')
    expect(res.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8010/internal/auth/login')
    expect((init.headers as Record<string, string>)['X-ESA-Internal-Token']).toBe('shared')
    expect(JSON.parse(init.body as string)).toEqual({ login: 'ivan', password: 'password123' })
  })

  it('отказ сервиса приходит кодом, а не исключением', async () => {
    vi.stubEnv('ESA_INTERNAL_URL', 'http://127.0.0.1:8010')
    vi.stubEnv('ESA_INTERNAL_TOKEN', 'shared')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'invalid_credentials' }, 401)))

    const res = await esaLogin('ivan', 'nope')
    expect(res).toEqual({ ok: false, status: 401, code: 'invalid_credentials' })
  })

  it('сетевой сбой — это unavailable, а не падение', async () => {
    vi.stubEnv('ESA_INTERNAL_URL', 'http://127.0.0.1:8010')
    vi.stubEnv('ESA_INTERNAL_TOKEN', 'shared')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    )

    const res = await esaLogin('ivan', 'password123')
    expect(res).toEqual({ ok: false, status: 0, code: 'unavailable' })
  })

  it('регистрация передаёт инвайт-код, только если он введён', async () => {
    vi.stubEnv('ESA_INTERNAL_URL', 'http://127.0.0.1:8010')
    vi.stubEnv('ESA_INTERNAL_TOKEN', 'shared')
    const fetchMock = vi.fn().mockResolvedValue(
      json({ ok: true, user: okUser, session: { name: 'setka_session', value: 'v', domain: null, path: '/', secure: true, max_age: 10 } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await esaRegister({ login: 'ivan', password: 'password123' })
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({
      login: 'ivan',
      password: 'password123',
    })

    await esaRegister({ login: 'ivan', password: 'password123', invite_code: 'code-1' })
    expect(
      JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string),
    ).toEqual({ login: 'ivan', password: 'password123', invite_code: 'code-1' })
  })
})

describe('кто вошёл и каталог', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('me передаёт значение зонной cookie и возвращает профиль', async () => {
    vi.stubEnv('ESA_INTERNAL_URL', 'http://127.0.0.1:8010')
    vi.stubEnv('ESA_INTERNAL_TOKEN', 'shared')
    const fetchMock = vi.fn().mockResolvedValue(json({ user: okUser }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await esaMe('session-token')
    expect(res.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8010/internal/auth/me')
    expect((init.headers as Record<string, string>)['X-ESA-Session']).toBe('session-token')
  })

  it('каталог сервисов приходит списком', async () => {
    vi.stubEnv('ESA_INTERNAL_URL', 'http://127.0.0.1:8010')
    vi.stubEnv('ESA_INTERNAL_TOKEN', 'shared')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ services: [{ title: 'вМалмыже.РФ', emoji: '🏛', url: 'https://x', desc: 'd' }] })),
    )

    const res = await esaServices()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toHaveLength(1)
  })
})
