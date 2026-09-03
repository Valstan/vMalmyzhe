// ── Ленивый до-тяг секрета из комнаты КАРМАНа (свойство 8 спеки vault-client) ──
//
// Спека: brain_matrica/docs/specs/vault-client.md. Санкция на этот путь —
// письмо brain 03.09 (D-061): секрет, выпущенный ДРУГИМ проектом и доставленный
// grant'ом, живёт только в комнате получателя — для него комната источник, а
// prod-env кэш, который может быть пуст. Сценарий A (восстановление) такой
// секрет не подхватит: он не входит в REQUIRED, и портал прекрасно стартует без
// него. Поэтому путь один — до-тяг в момент использования.
//
// В норме ноль сетевых вызовов: значение уже в окружении → выходим первой строкой.

// ⚠️ Allowlist: принимаем ТОЛЬКО эти имена, что бы ни пришло из комнаты.
// Якорь: новый секрет чужого выпуска в `.env.example` → добавить и сюда
// (пара меняется вместе — свойство 2 спеки, опыт trener 08-01).
const ACCEPTED = new Set<string>(['ESA_CLIENT_SECRET_PORTAL'])

// Свойство 6: bootstrap-конфиг самого клиента не принимается из хранилища,
// которому он адресуется, — иначе комната перенаправит будущие обращения на
// чужой URL. Отдельный список, а не «просто нет в allowlist»: если кто-то
// однажды впишет их в ACCEPTED, эта проверка всё равно не пустит.
const NEVER_FROM_VAULT = new Set<string>(['SECRETS_TOKEN', 'SECRETS_VAULT_URL'])

const ATTEMPT_PAUSES_MS = [1_000, 3_000] // 3 попытки: сразу, +1 с, +3 с
const ATTEMPT_TIMEOUT_MS = 5_000
const COOLDOWN_MS = 5 * 60_000

type EnsureReason =
  | 'already-present' // локальное сильнее (свойство 3)
  | 'not-accepted' // имя вне allowlist — программистская ошибка вызова
  | 'no-token'
  | 'no-vault-url'
  | 'cooldown' // ходили недавно и не нашли — не долбим комнату
  | 'pulled'
  | 'not-in-room' // 200/404, но значения нет: grant не виден или ключ не заведён
  | 'fetch-failed'

export type EnsureResult = { ok: boolean; reason: EnsureReason; ignored: string[] }

type Env = Record<string, string | undefined>

export type EnsureOptions = {
  env?: Env
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

// Момент последней безуспешной попытки по каждому имени — кулдаун (свойство 8).
const lastAttemptAt = new Map<string, number>()

export const resetVaultCooldown = (): void => {
  lastAttemptAt.clear()
}

// SECRETS_VAULT_URL можно задать и как базу (`https://<хост>`), и как полный
// адрес метода — приводим к одному виду. Хост КАРМАНа в репо не держим (D-038):
// значение живёт в prod-env, дефолта здесь нет намеренно.
const secretsEndpoint = (raw: string, name: string): string | null => {
  try {
    const base = raw.replace(/\/$/, '')
    const url = new URL(base.endsWith('/api/secrets') ? base : `${base}/api/secrets`)
    url.searchParams.set('key', name)
    return url.toString()
  } catch {
    return null
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Достаёт `name` в окружение, если его там нет: до 3 попыток в комнату
 * (паузы 1 с / 3 с, таймаут 5 с), кулдаун 5 минут между безуспешными заходами.
 * Best-effort: любой отказ — предупреждение в лог и `ok:false`, вызывающий код
 * продолжает работать так, как будто секрета нет. Значения в лог не попадают
 * никогда; имена вне allowlist логируются поимённо (свойство 7).
 */
export const ensureSecret = async (
  name: string,
  opts: EnsureOptions = {},
): Promise<EnsureResult> => {
  const env = opts.env ?? process.env
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? defaultSleep
  const doFetch = opts.fetchImpl ?? fetch
  const nothing = (reason: EnsureReason): EnsureResult => ({ ok: false, reason, ignored: [] })

  if (!ACCEPTED.has(name) || NEVER_FROM_VAULT.has(name)) {
    console.warn(`[secrets] ${name} вне allowlist — до-тяг не выполняется`)
    return nothing('not-accepted')
  }
  if (env[name]) return { ok: true, reason: 'already-present', ignored: [] }

  const token = env.SECRETS_TOKEN
  if (!token) {
    console.warn(`[secrets] ${name} нет в окружении, SECRETS_TOKEN не задан`)
    return nothing('no-token')
  }
  const rawUrl = env.SECRETS_VAULT_URL
  if (!rawUrl) {
    console.warn(`[secrets] ${name} нет в окружении, SECRETS_VAULT_URL не задан`)
    return nothing('no-vault-url')
  }
  const endpoint = secretsEndpoint(rawUrl, name)
  if (!endpoint) {
    console.warn('[secrets] SECRETS_VAULT_URL не разбирается как URL')
    return nothing('no-vault-url')
  }

  const last = lastAttemptAt.get(name)
  if (last !== undefined && now() - last < COOLDOWN_MS) return nothing('cooldown')
  lastAttemptAt.set(name, now())

  let lastError = ''
  for (let attempt = 0; attempt < ATTEMPT_PAUSES_MS.length + 1; attempt++) {
    if (attempt > 0) await sleep(ATTEMPT_PAUSES_MS[attempt - 1]!)
    try {
      const res = await doFetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      })
      // 404 — grant не виден комнате или ключ не заведён у источника. Это не
      // сетевой сбой: повторять смысла нет, ответ уже получен.
      if (res.status === 404) {
        console.warn(`[secrets] ${name}: комната ответила 404 — grant не виден`)
        return nothing('not-in-room')
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const body = (await res.json()) as { secrets?: Record<string, unknown> }
      const ignored: string[] = []
      let pulled = false
      for (const [key, value] of Object.entries(body.secrets ?? {})) {
        if (!ACCEPTED.has(key) || NEVER_FROM_VAULT.has(key)) {
          ignored.push(key) // имена, НЕ значения (свойство 7)
          continue
        }
        if (env[key] !== undefined) continue // systemd сильнее (свойство 3)
        if (typeof value !== 'string' || !value) continue
        env[key] = value
        if (key === name) pulled = true
      }
      if (ignored.length) {
        console.warn(`[secrets] вне allowlist, проигнорированы: ${ignored.join(', ')}`)
      }
      if (!pulled) {
        console.warn(`[secrets] ${name}: ответ 200, но значения нет`)
        return { ok: false, reason: 'not-in-room', ignored }
      }
      // Успех снимает кулдаун: следующий до-тяг (после ротации) не должен ждать.
      lastAttemptAt.delete(name)
      console.warn(`[secrets] ${name} получен из комнаты`)
      return { ok: true, reason: 'pulled', ignored }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  console.error(`[secrets] ${name}: до-тяг не удался после 3 попыток — ${lastError}`)
  return nothing('fetch-failed')
}
