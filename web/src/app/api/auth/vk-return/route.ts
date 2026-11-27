import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { esaMe, esaSessionCookieName } from '../../../../lib/auth/esaInternal'
import {
  SESSION_COOKIE,
  SESSION_COOKIE_ATTRS,
  SESSION_MAX_AGE_S,
  sealSession,
} from '../../../../lib/auth/session'

// GET /api/auth/vk-return — возврат из ВК-входа на портал.
//
// ВК-диалог по устройству единого входа всегда заземляется на issuer (ЕСА), и
// там ЕСА сама ставит зонную cookie сессии. Дальше ЕСА возвращает человека на
// портал — и портал забирает ЭТУ ЖЕ cookie (домен зоны, поэтому браузер
// присылает её и на вмалмыже.рф), спрашивает у ЕСА «кто это» по внутреннему
// API и заводит свою сессию.
//
// Пароль и токены ВК через портал не ходят: сессионный токен ЕСА — opaque,
// подпись у него своя.
export const dynamic = 'force-dynamic'

const safeNext = (raw: string | null): string => {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

export const GET = async (req: NextRequest): Promise<Response> => {
  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || '/'
  const token = req.cookies.get(esaSessionCookieName())?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=session', serverUrl), 303)
  }

  const me = await esaMe(token)
  if (!me.ok) {
    console.error(`[auth/vk-return] ЕСА не узнала сессию: ${me.code}`)
    return NextResponse.redirect(new URL('/login?error=session', serverUrl), 303)
  }

  const secret = process.env.PAYLOAD_SECRET
  if (!secret) {
    console.error('[auth/vk-return] нет PAYLOAD_SECRET — сессию портала не записать')
    return NextResponse.redirect(new URL('/login?error=unavailable', serverUrl), 303)
  }

  const next = safeNext(req.nextUrl.searchParams.get('next'))
  const res = NextResponse.redirect(new URL(next, serverUrl), 303)
  res.cookies.set(
    SESSION_COOKIE,
    sealSession(
      {
        sub: me.value.sub,
        email: me.value.email_verified ? me.value.email : null,
        name: me.value.display_name || me.value.login,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S,
      },
      secret,
    ),
    { ...SESSION_COOKIE_ATTRS, maxAge: SESSION_MAX_AGE_S },
  )
  return res
}
