import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { authEnv, clearSessionCookie } from '../_shared'

// POST /api/auth/logout — снять сессию жителя (только cookie: у ЕСА своя
// сессия, её не трогаем — как и у Интера). POST, не GET: чтобы ссылка с
// чужого сайта не разлогинивала (sameSite=lax cookie на GET доедет).
export const dynamic = 'force-dynamic'

export const POST = async (req: NextRequest): Promise<Response> => {
  const env = authEnv(req.nextUrl.origin)
  if (!env) return new Response('Not Found', { status: 404 })
  const res = NextResponse.redirect(new URL('/', env.serverUrl), 303)
  clearSessionCookie(res)
  return res
}
