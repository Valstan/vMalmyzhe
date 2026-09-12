import type { EsaClaims } from './oidc'
import { open, seal } from './oidc'

// ── Сессия жителя ─────────────────────────────────────────────────────────────
//
// Что получает вошедший житель — открытый продуктовый вопрос владельца
// (письмо brain 26.07). До ответа сессия — «вход и узнавание»: подписанная
// httpOnly-cookie без записи в БД (нет коллекции — нет миграции, нет мины
// с падением ЕСА: cookie живёт своим сроком, ЕСА нужна только на входе).
// Persist-слой (коллекция residents) появится вместе с первой фичей за входом.
//
// Админка Payload под ЕСА не заводится намеренно (SERVICE_ONBOARDING): падение
// ЕСА не должно лишать редакцию возможности править контент. Персонал — users.

// Имя с префиксом `__Host-` (#285, письмо brain 05.09): любой сосед под
// вмалмыже.рф может выставить cookie с `Domain=.вмалмыже.рф`, и при двух cookie
// с одним именем побеждает подброшенная. Браузер принимает `__Host-` только с
// `Secure`, `Path=/` и без `Domain` — подбросить её с поддомена нельзя.
// Старое имя читаем до истечения выданных сессий (30 дней) и гасим при выходе;
// пишем только новое. Снять `SESSION_COOKIE_LEGACY` — после 2026-10-12.
export const SESSION_COOKIE = '__Host-vm_resident'
export const SESSION_COOKIE_LEGACY = 'vm_resident'
export const SESSION_MAX_AGE_S = 30 * 24 * 3600

// Атрибуты новой cookie — единым набором: ставим и гасим одними и теми же.
// `secure` всегда, не «в проде»: без него префикс браузер отвергнет молча,
// а localhost современные браузеры считают secure-контекстом и по http.
export const SESSION_COOKIE_ATTRS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: true,
  path: '/',
} as const

// Новое имя в приоритете: если обе есть, старую мог подбросить сосед.
export const readSessionCookie = (get: (name: string) => string | undefined): string | undefined =>
  get(SESSION_COOKIE) ?? get(SESSION_COOKIE_LEGACY)

export type ResidentSession = {
  sub: string
  email: string | null
  name: string | null
  // unix seconds — истечение сверяем сами: у cookie срок не подписан.
  exp: number
}

export const sessionFromClaims = (claims: EsaClaims, nowS: number): ResidentSession => ({
  sub: claims.sub,
  // Неподтверждённый email не показываем и не храним: узнавание по нему
  // запрещено (анти-захват) — а раз не используем, то и не тянем.
  email: claims.emailVerified ? claims.email : null,
  name: claims.name,
  exp: nowS + SESSION_MAX_AGE_S,
})

export const sealSession = (s: ResidentSession, secret: string): string => seal(s, secret)

export const openSession = (
  sealed: string | undefined,
  secret: string,
  nowS: number,
): ResidentSession | null => {
  if (!sealed) return null
  const p = open(sealed, secret) as Partial<ResidentSession> | null
  if (!p || typeof p.sub !== 'string' || !p.sub || typeof p.exp !== 'number') return null
  if (p.exp <= nowS) return null
  return {
    sub: p.sub,
    email: typeof p.email === 'string' ? p.email : null,
    name: typeof p.name === 'string' ? p.name : null,
    exp: p.exp,
  }
}

// Что уходит в браузер через /api/auth/me — без sub (внутренний идентификатор
// ЕСА наружу не нужен) и без exp.
export const publicProfile = (s: ResidentSession): { name: string; email: string | null } => ({
  name: s.name || (s.email ? s.email.split('@')[0] : 'Житель'),
  email: s.email,
})
