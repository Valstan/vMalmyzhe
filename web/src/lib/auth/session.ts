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

export const SESSION_COOKIE = 'vm_resident'
export const SESSION_MAX_AGE_S = 30 * 24 * 3600

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
