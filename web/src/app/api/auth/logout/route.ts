import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { buildEndSessionUrl, getDiscovery } from '../../../../lib/auth/oidc'
import { authEnv, clearSessionCookie } from '../_shared'

// POST /api/auth/logout — снять сессию жителя и погасить сессию ЕСА.
// POST, не GET: чтобы ссылка с чужого сайта не разлогинивала (sameSite=lax
// cookie на GET доедет).
//
// Два шага, и первый не зависит от второго: наша cookie снимается ВСЕГДА, даже
// если ЕСА недоступна или ещё не умеет end_session — тогда человек просто
// возвращается на портал вышедшим отсюда (старое поведение, мандат brain 04.09
// его не отменяет, а расширяет). Редирект 303: POST превращается в GET, а
// end_session ЕСА — GET-эндпойнт.
export const dynamic = 'force-dynamic'

export const POST = async (req: NextRequest): Promise<Response> => {
  const env = await authEnv(req.nextUrl.origin)
  if (!env) return new Response('Not Found', { status: 404 })

  const home = new URL('/', env.serverUrl).toString()
  let target = home
  try {
    target = buildEndSessionUrl(env.cfg, await getDiscovery(env.cfg)) ?? home
  } catch (err) {
    // ЕСА недоступна — выходим хотя бы из портала, деталей наружу не раскрываем.
    console.error('[auth/logout]', err instanceof Error ? err.message : err)
  }

  const res = NextResponse.redirect(target, 303)
  clearSessionCookie(res)
  return res
}
