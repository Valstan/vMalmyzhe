import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { esaLogin, esaRegister } from '../../../../lib/auth/esaInternal'
import type { EsaSessionCookie } from '../../../../lib/auth/esaInternal'
import {
  SESSION_COOKIE,
  SESSION_COOKIE_ATTRS,
  SESSION_MAX_AGE_S,
  sealSession,
} from '../../../../lib/auth/session'

// POST /api/auth/password — вход посетителя по логину и паролю, и регистрация.
//
// Форма (обычный POST, без JS): логином/паролем человек заходит на портал и на
// все соседние сервисы зоны сразу. Проверка пароля — на сервере ЕСА (сервер к
// серверу по loopback): пароль не ходит через браузер.
//
// Две cookie в ответе:
//   * `__Host-vm_resident` — сессия портала (host-only, подпись PAYLOAD_SECRET);
//   * `setka_session` с доменом зоны — сессия ЕСА, общая для всех сервисов
//     экосистемы (D-072: «вход сам по себе и есть фича»).
export const dynamic = 'force-dynamic'

const LOGIN_RE = /^[a-zA-Z0-9_.-]{3,64}$/

// Куда возвращать после входа: только относительный путь внутри портала.
// `//evil` — протокол-относительный URL, его отбрасываем.
const safeNext = (raw: string | null): string => {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

// Коды отказа едут в адрес как есть: текст пользователю даёт страница входа
// (единое место, где живут все формулировки), детали — в лог.
const fail = (mode: string, code: string): Response => {
  const params = new URLSearchParams({ error: code })
  if (mode === 'register') params.set('mode', 'register')
  return NextResponse.redirect(new URL(`/login?${params.toString()}`, process.env.NEXT_PUBLIC_SERVER_URL || '/'), 303)
}

// Ставим cookie сессии ЕСА ровно как её описал сервис: домен зоны, Secure,
// httpOnly. Наша подпись тут ни при чём — значение ЕСА подписала сама.
const setEsaSessionCookie = (res: NextResponse, session: EsaSessionCookie): void => {
  res.cookies.set(session.name, session.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: session.secure,
    path: session.path || '/',
    ...(session.domain ? { domain: session.domain } : {}),
    maxAge: session.max_age,
  })
}

export const POST = async (req: NextRequest): Promise<Response> => {
  const form = await req.formData()
  const mode = form.get('mode') === 'register' ? 'register' : 'login'
  const login = String(form.get('login') ?? '').trim()
  const password = String(form.get('password') ?? '')
  const email = String(form.get('email') ?? '').trim()
  const inviteCode = String(form.get('inviteCode') ?? '').trim()
  const next = safeNext(String(form.get('next') ?? ''))

  if (!LOGIN_RE.test(login) || password.length < 8 || password.length > 256) {
    return fail(mode, 'invalid_request')
  }

  const result =
    mode === 'register'
      ? await esaRegister({
          login,
          password,
          ...(email ? { email } : {}),
          ...(inviteCode ? { invite_code: inviteCode } : {}),
        })
      : await esaLogin(login, password)

  if (!result.ok) {
    console.error(`[auth/password] отказ (${mode}): ${result.code}`)
    return fail(mode, result.code)
  }

  const { user, session } = result.value
  const secret = process.env.PAYLOAD_SECRET
  if (!secret) {
    console.error('[auth/password] нет PAYLOAD_SECRET — сессию портала не записать')
    return fail(mode, 'unavailable')
  }

  const nowS = Math.floor(Date.now() / 1000)
  const res = NextResponse.redirect(new URL(next, process.env.NEXT_PUBLIC_SERVER_URL || '/'), 303)
  res.cookies.set(
    SESSION_COOKIE,
    sealSession(
      {
        sub: user.sub,
        email: user.email_verified ? user.email : null,
        name: user.display_name || user.login,
        exp: nowS + SESSION_MAX_AGE_S,
      },
      secret,
    ),
    { ...SESSION_COOKIE_ATTRS, maxAge: SESSION_MAX_AGE_S },
  )
  setEsaSessionCookie(res, session)
  return res
}
