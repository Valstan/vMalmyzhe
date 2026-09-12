import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { openSession, publicProfile, readSessionCookie } from '../../../../lib/auth/session'
import { authEnv } from '../_shared'

// GET /api/auth/me — кто вошёл, для кнопки в шапке. Страницы портала остаются
// статичными: cookie читается только здесь, клиентом после загрузки.
// { enabled: false }         — вход выключен (нет секрета ЕСА)
// { enabled: true, user }    — user: { name, email } | null
export const dynamic = 'force-dynamic'

export const GET = async (req: NextRequest): Promise<Response> => {
  const env = await authEnv(req.nextUrl.origin)
  const noStore = { headers: { 'Cache-Control': 'no-store' } }
  if (!env) return NextResponse.json({ enabled: false, user: null }, noStore)

  const session = openSession(
    readSessionCookie((name) => req.cookies.get(name)?.value),
    env.secret,
    Math.floor(Date.now() / 1000),
  )
  return NextResponse.json(
    { enabled: true, user: session ? publicProfile(session) : null },
    noStore,
  )
}
