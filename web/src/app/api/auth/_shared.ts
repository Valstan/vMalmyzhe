import { NextResponse } from 'next/server'

import type { EsaConfig } from '../../../lib/auth/esa'
import { getEsaConfig } from '../../../lib/auth/esa'
import { SESSION_COOKIE } from '../../../lib/auth/session'

// Общее для маршрутов /api/auth/*: конфиг ЕСА + секрет подписи cookie.
// Нет секрета ЕСА → вход выключен, маршрутов «нет» (404): портал живёт без входа.
export const TX_COOKIE = 'vm_oidc_tx'
export const TX_COOKIE_PATH = '/api/auth'

export type AuthEnv = { cfg: EsaConfig; secret: string; serverUrl: string }

export const authEnv = (fallbackOrigin: string): AuthEnv | null => {
  const cfg = getEsaConfig()
  const secret = process.env.PAYLOAD_SECRET
  if (!cfg || !secret) return null
  return { cfg, secret, serverUrl: process.env.NEXT_PUBLIC_SERVER_URL || fallbackOrigin }
}

export const isSecure = (env: AuthEnv): boolean => env.cfg.redirectUri.startsWith('https://')

export const clearTxCookie = (res: NextResponse): void => {
  res.cookies.set(TX_COOKIE, '', { path: TX_COOKIE_PATH, maxAge: 0 })
}

export const clearSessionCookie = (res: NextResponse): void => {
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
}
