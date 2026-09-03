'use client'

import { useEffect, useState } from 'react'

type Me = { enabled: boolean; user: { name: string; email: string | null } | null }

// Кнопка входа через ЕСА в шапке. Клиентский компонент намеренно: страницы
// портала статичные (ISR), cookie сессии читается только в /api/auth/me после
// загрузки. Пока ответа нет или вход выключен — ничего не рендерим: шапка без
// ЕСА выглядит как раньше.
export function AuthBadge() {
  const [me, setMe] = useState<Me | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/auth/me', { signal: ctrl.signal, credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .then((m) => m && setMe(m))
      .catch(() => {})

    const auth = new URLSearchParams(window.location.search).get('auth')
    if (auth === 'failed') setNotice('Вход не удался. Попробуйте ещё раз.')
    if (auth === 'unavailable') setNotice('Единая система авторизации сейчас недоступна.')

    return () => ctrl.abort()
  }, [])

  if (!me?.enabled) return null

  const next = typeof window !== 'undefined' ? window.location.pathname : '/'
  const startHref = `/api/auth/start?next=${encodeURIComponent(next)}`

  return (
    <div className="auth-badge">
      {notice ? (
        <span className="auth-badge__notice" role="status">
          {notice}
        </span>
      ) : null}
      {me.user ? (
        <form method="post" action="/api/auth/logout" className="auth-badge__user">
          <span className="auth-badge__name" title={me.user.email ?? undefined}>
            {me.user.name}
          </span>
          <button type="submit" className="auth-badge__logout">
            Выйти
          </button>
        </form>
      ) : (
        <a className="auth-badge__login" href={startHref}>
          Войти
        </a>
      )}
    </div>
  )
}
