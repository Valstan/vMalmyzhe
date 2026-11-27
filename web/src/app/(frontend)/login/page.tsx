import type { Metadata } from 'next'

import { authErrorText } from '../../../lib/auth/errors'
import { esaPublicUrl } from '../../../lib/auth/esaInternal'
import { SITE_URL } from '../../../lib/site'

// Вход в экосистему вМалмыже.рф — страница портала.
//
// Человек заходит по логину и паролю (регистрация — рядом) или по ВК ID.
// Успех обрабатывает /api/auth/password: сервер спрашивает ЕСА по внутреннему
// API и ставит две cookie — сессию портала и зонную сессию ЕСА (вход общий для
// всех сервисов зоны).
//
// Страница читает query, поэтому динамическая: отдавать её из ISR нельзя —
// в адресе может быть код отказа.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Вход',
  description:
    'Вход в экосистему вМалмыже.рф: один аккаунт для портала и всех городских сервисов — по логину с паролем или через ВК ID.',
  alternates: { canonical: '/login' },
}

type Args = { searchParams: Promise<{ mode?: string; error?: string; next?: string }> }

export default async function LoginPage({ searchParams }: Args) {
  const sp = await searchParams
  const register = sp.mode === 'register'
  const error = authErrorText(sp.error ?? null)
  const next = sp.next && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/'
  const esaUrl = esaPublicUrl()
  const vkHref = esaUrl
    ? `${esaUrl}/auth/vk/login?next=${encodeURIComponent(`${SITE_URL}/api/auth/vk-return?next=${encodeURIComponent(next)}`)}`
    : null

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">Единый вход</p>
        <h1>{register ? 'Регистрация' : 'Вход в экосистему'}</h1>
        <p className="muted">
          Один аккаунт для портала и всех городских сервисов Малмыжа: новости, афиша,
          справчник услуг, праздники, школа. Вход общий — на любом сервисе вы уже
          вошли.
        </p>

        {error ? (
          <p className="auth-card__error" role="alert">
            {error}
          </p>
        ) : null}

        <form method="post" action="/api/auth/password" className="auth-form">
          <input type="hidden" name="mode" value={register ? 'register' : 'login'} />
          <input type="hidden" name="next" value={next} />
          <label className="auth-form__field">
            <span>Логин</span>
            <input
              name="login"
              type="text"
              required
              minLength={3}
              maxLength={64}
              autoComplete="username"
              pattern="[A-Za-z0-9_.-]{3,64}"
              placeholder="ivan_petrov"
            />
          </label>
          <label className="auth-form__field">
            <span>Пароль</span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={256}
              autoComplete={register ? 'new-password' : 'current-password'}
              placeholder="не короче 8 знаков"
            />
          </label>
          {register ? (
            <>
              <label className="auth-form__field">
                <span>Электронная почта (если есть)</span>
                <input name="email" type="email" autoComplete="email" placeholder="ivan@example.ru" />
              </label>
              <label className="auth-form__field">
                <span>Инвайт-код (если требуется)</span>
                <input name="inviteCode" type="text" autoComplete="off" placeholder="если вход свободный — оставьте пустым" />
              </label>
            </>
          ) : null}
          <button type="submit" className="button auth-form__submit">
            {register ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>

        {vkHref ? (
          <>
            <div className="auth-card__or">или</div>
            <a className="button button--secondary auth-card__vk" href={vkHref}>
              Войти через ВК ID
            </a>
          </>
        ) : (
          <p className="muted">Вход через ВК ID сейчас недоступен.</p>
        )}

        {/* Запасной путь — классический OIDC-вход через страницу ЕСА. Он работает,
            даже если внутренний API недоступен: браузер сам уходит на
            вход.вмалмыже.рф и возвращается сюда с кодом. */}
        <p className="auth-card__switch">
          <a href={`/api/auth/start?next=${encodeURIComponent(next)}`}>
            Войти через единый вход (вход.вмалмыже.рф)
          </a>
        </p>

        <p className="auth-card__switch">
          {register ? (
            <>
              Уже есть аккаунт?{' '}
              <a href={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>Войти</a>
            </>
          ) : (
            <>
              Нет аккаунта?{' '}
              <a
                href={`/login?mode=register${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`}
              >
                Зарегистрироваться
              </a>
            </>
          )}
        </p>

        <p className="auth-card__note">
          Нажимая «Войти», вы соглашаетесь с тем, что сервисы экосистемы узнают, что вы
          вошли. Данные останутся в Малмыже — ими делятся только сервисы, куда вы
          вошли сами.
        </p>
      </div>
    </section>
  )
}
