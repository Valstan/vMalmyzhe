// ── Формулировки отказов входа ─────────────────────────────────────────────
//
// Коды приезжают из /api/auth/password и /api/auth/vk-return query'ем.
// Тексты живут здесь одним списком: страница входа — единственное место,
// где человек читает, что пошло не так.

const AUTH_ERRORS: Record<string, string> = {
  invalid_credentials: 'Неверный логин или пароль.',
  login_taken: 'Такой логин уже занят — попробуйте другой.',
  invite_required: 'Регистрация по инвайт-коду: введите код.',
  invalid_invite: 'Неверный инвайт-код.',
  invalid_request: 'Проверьте логин и пароль: логин — латиницей, пароль — от 8 знаков.',
  unavailable: 'Единая система авторизации сейчас недоступна. Попробуйте позже.',
  session: 'Вход не завершился. Попробуйте ещё раз.',
  failed: 'Вход не удался. Попробуйте ещё раз.',
}

export const authErrorText = (code: string | null): string | null =>
  code ? (AUTH_ERRORS[code] ?? AUTH_ERRORS.unavailable ?? null) : null
