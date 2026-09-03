import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureSecret, resetVaultCooldown } from './secretsVault'

const NAME = 'ESA_CLIENT_SECRET_PORTAL'
const base = () => ({
  SECRETS_TOKEN: 'room-token',
  SECRETS_VAULT_URL: 'https://vault.example',
}) as Record<string, string | undefined>

const okResponse = (secrets: Record<string, unknown>) =>
  ({ ok: true, status: 200, json: async () => ({ secrets }) }) as unknown as Response

const noSleep = async (): Promise<void> => {}

beforeEach(() => {
  resetVaultCooldown()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('ensureSecret — норма', () => {
  it('значение уже в окружении → ноль сетевых вызовов', async () => {
    const fetchImpl = vi.fn()
    const env = { ...base(), [NAME]: 'local' }
    const r = await ensureSecret(NAME, { env, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r).toEqual({ ok: true, reason: 'already-present', ignored: [] })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('нет в окружении → тянет из комнаты и кладёт в env', async () => {
    const env = base()
    const fetchImpl = vi.fn(async (_url: string) => okResponse({ [NAME]: 'from-room' }))
    const r = await ensureSecret(NAME, { env, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.ok).toBe(true)
    expect(r.reason).toBe('pulled')
    expect(env[NAME]).toBe('from-room')
    const url = fetchImpl.mock.calls[0]![0] as string
    expect(url).toBe(`https://vault.example/api/secrets?key=${NAME}`)
  })

  it('полный адрес метода в SECRETS_VAULT_URL не удваивается', async () => {
    const env = { ...base(), SECRETS_VAULT_URL: 'https://vault.example/api/secrets' }
    const fetchImpl = vi.fn(async (_url: string) => okResponse({ [NAME]: 'v' }))
    await ensureSecret(NAME, { env, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl.mock.calls[0]![0]).toBe(`https://vault.example/api/secrets?key=${NAME}`)
  })
})

// Мутационная приёмка allowlist (#114): без этого прогона allowlist — декорация.
describe('ensureSecret — негативный прогон allowlist', () => {
  it('чужие ключи из комнаты в окружение НЕ попадают и логируются поимённо', async () => {
    const env = base()
    const fetchImpl = vi.fn(async () =>
      okResponse({
        [NAME]: 'ok',
        NODE_OPTIONS: '--require /tmp/pwn.js',
        LD_PRELOAD: '/tmp/pwn.so',
        DATABASE_URI: 'postgres://attacker/db',
      }),
    )
    const r = await ensureSecret(NAME, { env, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.ok).toBe(true)
    expect(env[NAME]).toBe('ok')
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.LD_PRELOAD).toBeUndefined()
    expect(env.DATABASE_URI).toBeUndefined()
    expect(r.ignored.sort()).toEqual(['DATABASE_URI', 'LD_PRELOAD', 'NODE_OPTIONS'])
  })

  it('bootstrap-конфиг клиента из комнаты не принимается никогда (свойство 6)', async () => {
    const env = base()
    const fetchImpl = vi.fn(async () =>
      okResponse({
        [NAME]: 'ok',
        SECRETS_TOKEN: 'stolen',
        SECRETS_VAULT_URL: 'https://evil.example',
      }),
    )
    const r = await ensureSecret(NAME, { env, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(env.SECRETS_TOKEN).toBe('room-token')
    expect(env.SECRETS_VAULT_URL).toBe('https://vault.example')
    expect(r.ignored.sort()).toEqual(['SECRETS_TOKEN', 'SECRETS_VAULT_URL'])
  })

  it('имя вне allowlist не тянется вовсе', async () => {
    const fetchImpl = vi.fn()
    const r = await ensureSecret('SOME_OTHER_KEY', {
      env: base(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r.reason).toBe('not-accepted')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('локальное значение сильнее пришедшего (свойство 3)', async () => {
    const env = { ...base(), OTHER: 'local' } as Record<string, string | undefined>
    const fetchImpl = vi.fn(async () => okResponse({ [NAME]: 'v', OTHER: 'from-room' }))
    await ensureSecret(NAME, { env, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(env.OTHER).toBe('local')
  })
})

describe('ensureSecret — отказы и повторы', () => {
  it('нет токена / нет URL → best-effort, без сети', async () => {
    const fetchImpl = vi.fn()
    const f = fetchImpl as unknown as typeof fetch
    expect((await ensureSecret(NAME, { env: { SECRETS_VAULT_URL: 'https://v' }, fetchImpl: f })).reason).toBe('no-token')
    expect((await ensureSecret(NAME, { env: { SECRETS_TOKEN: 't' }, fetchImpl: f })).reason).toBe('no-vault-url')
    expect(
      (await ensureSecret(NAME, { env: { SECRETS_TOKEN: 't', SECRETS_VAULT_URL: 'не-url' }, fetchImpl: f })).reason,
    ).toBe('no-vault-url')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('сетевой сбой → ровно 3 попытки, потом fetch-failed', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const r = await ensureSecret(NAME, {
      env: base(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    })
    expect(r.reason).toBe('fetch-failed')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('404 — grant не виден, повторять нечего: одна попытка', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response)
    const r = await ensureSecret(NAME, {
      env: base(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    })
    expect(r.reason).toBe('not-in-room')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('200 без нужного ключа → not-in-room', async () => {
    const fetchImpl = vi.fn(async () => okResponse({}))
    const r = await ensureSecret(NAME, { env: base(), fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.reason).toBe('not-in-room')
  })

  it('кулдаун 5 минут: второй заход в окне в комнату не идёт, после окна идёт', async () => {
    const fetchImpl = vi.fn(async () => okResponse({}))
    const f = fetchImpl as unknown as typeof fetch
    let t = 1_000_000
    const now = () => t
    await ensureSecret(NAME, { env: base(), fetchImpl: f, now, sleep: noSleep })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    t += 4 * 60_000
    expect((await ensureSecret(NAME, { env: base(), fetchImpl: f, now, sleep: noSleep })).reason).toBe('cooldown')
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    t += 2 * 60_000
    await ensureSecret(NAME, { env: base(), fetchImpl: f, now, sleep: noSleep })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('успех снимает кулдаун — ротация не ждёт 5 минут', async () => {
    const env = base()
    const fetchImpl = vi.fn(async () => okResponse({ [NAME]: 'v1' }))
    const f = fetchImpl as unknown as typeof fetch
    const now = () => 5_000_000
    await ensureSecret(NAME, { env, fetchImpl: f, now, sleep: noSleep })
    delete env[NAME] // как будто значение сбросили и тянем заново
    await ensureSecret(NAME, { env, fetchImpl: f, now, sleep: noSleep })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
