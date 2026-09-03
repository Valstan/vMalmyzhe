import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import {
  buildAuthorizeUrl,
  getDiscovery,
  randomToken,
  sanitizeNextPath,
  seal,
} from '../../../../lib/auth/oidc'
import { TX_COOKIE, TX_COOKIE_PATH, authEnv, isSecure } from '../_shared'

// GET /api/auth/start[?next=/путь] — начало входа через ЕСА: state (CSRF) +
// nonce (replay) + PKCE-verifier в короткоживущей подписанной httpOnly-cookie,
// редирект на authorize ЕСА. Вернётся на /api/auth/callback с одноразовым кодом.
export const dynamic = 'force-dynamic'

export const GET = async (req: NextRequest): Promise<Response> => {
  const env = authEnv(req.nextUrl.origin)
  if (!env) return new Response('Not Found', { status: 404 })

  try {
    const discovery = await getDiscovery(env.cfg)
    const next = sanitizeNextPath(req.nextUrl.searchParams.get('next'))
    const tx = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(),
      ...(next ? { next } : {}),
    }

    const res = NextResponse.redirect(buildAuthorizeUrl(env.cfg, discovery, tx), 302)
    res.cookies.set(TX_COOKIE, seal(tx, env.secret), {
      httpOnly: true,
      sameSite: 'lax', // lax: cookie доедет на top-level redirect от ЕСА
      secure: isSecure(env),
      path: TX_COOKIE_PATH,
      maxAge: 600,
    })
    return res
  } catch (err) {
    // ЕСА недоступна (discovery упал) — портал цел, пользователь на главной
    // с пометкой; деталей наружу не раскрываем.
    console.error('[auth/start]', err instanceof Error ? err.message : err)
    return NextResponse.redirect(new URL('/?auth=unavailable', env.serverUrl), 302)
  }
}
