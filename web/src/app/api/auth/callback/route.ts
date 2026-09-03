import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import {
  exchangeCode,
  getDiscovery,
  openTransaction,
  verifyIdToken,
} from '../../../../lib/auth/oidc'
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  sealSession,
  sessionFromClaims,
} from '../../../../lib/auth/session'
import { TX_COOKIE, authEnv, clearTxCookie, isSecure } from '../_shared'

// GET /api/auth/callback — возврат из ЕСА: state против подписанной cookie
// (CSRF), code → токены (PKCE-verifier + client_secret), проверка id_token
// (подпись JWKS / iss / aud / exp / nonce) → сессия жителя → назад на портал.
//
// Любой отказ — мягкий редирект на главную с ?auth=failed: портал цел,
// деталей отказа наружу не раскрываем (в лог — да).
export const dynamic = 'force-dynamic'

export const GET = async (req: NextRequest): Promise<Response> => {
  const env = await authEnv(req.nextUrl.origin)
  if (!env) return new Response('Not Found', { status: 404 })

  const fail = (reason: string): Response => {
    console.error(`[auth/callback] отказ: ${reason}`)
    const res = NextResponse.redirect(new URL('/?auth=failed', env.serverUrl), 302)
    clearTxCookie(res)
    return res
  }

  const params = req.nextUrl.searchParams
  if (params.get('error')) return fail(`ЕСА вернула error=${params.get('error')}`)

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return fail('нет code/state в callback')

  const tx = openTransaction(req.cookies.get(TX_COOKIE)?.value ?? '', env.secret)
  if (!tx) return fail('транзакционная cookie отсутствует/не прошла подпись')
  if (tx.state !== state) return fail('state не совпал (CSRF?)')

  try {
    const discovery = await getDiscovery(env.cfg)
    const { idToken } = await exchangeCode(env.cfg, discovery, code, tx.verifier)
    const claims = await verifyIdToken(env.cfg, discovery, idToken, tx.nonce)

    const session = sessionFromClaims(claims, Math.floor(Date.now() / 1000))
    const res = NextResponse.redirect(new URL(tx.next ?? '/', env.serverUrl), 302)
    clearTxCookie(res)
    res.cookies.set(SESSION_COOKIE, sealSession(session, env.secret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure(env),
      path: '/',
      maxAge: SESSION_MAX_AGE_S,
    })
    return res
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}
