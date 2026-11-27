// ── Внутренний API ЕСА: клиент серверной стороны ───────────────────────────
//
// ЕСА (единая система авторизации экосистемы вМалмыже.рф) живёт отдельным
// сервисом на этом же боксе и слушает loopback. Портал ходит к нему от сервера
// к серверу: пароль посетителя не уходит в браузер и не ходит через интернет,
// а вход остаётся общим для всей зоны .вмалмыже.рф.
//
// Граница: /internal/* сервис отдаёт ТОЛЬКО с loopback и только с общим
// токеном; nginx наружу эти пути не проксирует (см. deploy/nginx/esa.conf).
// Наружу у портала — только /api/auth/*, которые зовут этот модуль.
//
// Адрес и токен живут в prod-env (D-038: никаких дефолтов-литералов —
// пустое значение должно падать, а не подставлять адрес). Нет конфигурации —
// портал живёт без входа (graceful-degrade, как и с клиентским секретом).

export type EsaUser = {
  sub: string
  login: string
  email: string | null
  // Флаг подтверждения адреса: портал кладёт email в сессию только при true
  // (анти-захват — неподтверждённый адрес не показываем и не храним).
  email_verified?: boolean
  display_name: string | null
  role: string
}

// Описание cookie сессии ЕСА: портал ставит её как есть — с доменом зоны
// (`.вмалмыже.рф`), чтобы вход был общим для всех сервисов экосистемы.
export type EsaSessionCookie = {
  name: string
  value: string
  domain: string | null
  path: string
  secure: boolean
  max_age: number
}

export type EsaService = {
  title: string
  emoji: string
  url: string
  desc: string
}

export type EsaAuthResult = {
  ok: true
  user: EsaUser
  session: EsaSessionCookie
}

type EsaAuthFailure = {
  ok: false
  status: number
  code: string
}

export type EsaResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string }

const TIMEOUT_MS = 5_000

// Адрес внутреннего API ЕСА. Без дефолта: неизвестный адрес — это «входа нет»,
// а не «вход куда-то попал».
export const esaInternalUrl = (): string | null => {
  const raw = (process.env.ESA_INTERNAL_URL || '').trim()
  return raw ? raw.replace(/\/$/, '') : null
}

// Общий токен сервер-сервер. Пустой = внутренний API недоступен.
const esaInternalToken = (): string => (process.env.ESA_INTERNAL_TOKEN || '').trim()

// Имя cookie сессии ЕСА: по ней портал забирает результат ВК-входа (cookie
// зоновая, поэтому браузер присылает её и на вмалмыже.рф).
export const esaSessionCookieName = (): string =>
  (process.env.ESA_SESSION_COOKIE_NAME || 'setka_session').trim() || 'setka_session'

const parseFailure = (status: number, body: unknown): EsaAuthFailure => {
  const code =
    body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
      ? body.code
      : 'unavailable'
  return { ok: false, status, code }
}

const call = async (path: string, body?: unknown): Promise<Response | null> => {
  const base = esaInternalUrl()
  const token = esaInternalToken()
  if (!base || !token) return null
  try {
    return await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'X-ESA-Internal-Token': token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    return null
  }
}

// Вход по логину и паролю. `code` в отказе: 'invalid_credentials' — неверная
// пара, 'unavailable' — сервис недоступен, 'invalid_request' — плохие данные.
export const esaLogin = async (
  login: string,
  password: string,
): Promise<EsaResult<EsaAuthResult>> => {
  const res = await call('/internal/auth/login', { login, password })
  if (!res) return { ok: false, status: 0, code: 'unavailable' }
  const payload = (await res.json().catch(() => null)) as EsaAuthResult | null
  if (!res.ok || !payload || payload.ok !== true) {
    return parseFailure(res.status, payload)
  }
  return { ok: true, value: payload }
}

// Регистрация посетителя. Инвайт-код нужен, только если сервис его требует.
export const esaRegister = async (input: {
  login: string
  password: string
  email?: string
  invite_code?: string
}): Promise<EsaResult<EsaAuthResult>> => {
  const res = await call('/internal/auth/register', input)
  if (!res) return { ok: false, status: 0, code: 'unavailable' }
  const payload = (await res.json().catch(() => null)) as EsaAuthResult | null
  if (!res.ok || !payload || payload.ok !== true) {
    return parseFailure(res.status, payload)
  }
  return { ok: true, value: payload }
}

// Кто вошёл: портал отдаёт ЕСА значение зонной cookie и получает профиль.
export const esaMe = async (sessionToken: string): Promise<EsaResult<EsaUser>> => {
  const base = esaInternalUrl()
  const token = esaInternalToken()
  if (!base || !token || !sessionToken) return { ok: false, status: 0, code: 'unavailable' }
  try {
    const res = await fetch(`${base}/internal/auth/me`, {
      method: 'GET',
      headers: { 'X-ESA-Internal-Token': token, 'X-ESA-Session': sessionToken },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    const payload = (await res.json().catch(() => null)) as { user?: EsaUser } | null
    if (!res.ok || !payload?.user) {
      return parseFailure(res.status, payload)
    }
    return { ok: true, value: payload.user }
  } catch {
    return { ok: false, status: 0, code: 'unavailable' }
  }
}

// Каталог сервисов экосистемы — один источник (владеет им сервис ЕСА).
export const esaServices = async (): Promise<EsaResult<EsaService[]>> => {
  const res = await call('/internal/services')
  if (!res) return { ok: false, status: 0, code: 'unavailable' }
  const payload = (await res.json().catch(() => null)) as { services?: EsaService[] } | null
  if (!res.ok || !Array.isArray(payload?.services)) {
    return parseFailure(res.status, payload)
  }
  return { ok: true, value: payload.services }
}

// Публичный адрес ЕСА для ВК-входа: браузер идёт туда сам, без прокси.
export const esaPublicUrl = (): string | null => {
  const raw = (process.env.ESA_PUBLIC_URL || '').trim()
  return raw ? raw.replace(/\/$/, '') : null
}
