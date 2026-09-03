import type { Access } from 'payload'

// Черновики видит ПЕРСОНАЛ (admin/editor); все остальные — только опубликованное.
//
// Раньше здесь стояло `if (user) return true` — «вошедший = свой». Это было
// верно, пока войти мог только персонал, и перестало бы быть верным в тот день,
// когда у портала появится вошедший житель с записью в `users`. Класс найден
// ТАКСИ 03.09 на живом проекте: правило `Boolean(req.user)` превратилось в дыру
// ровно в момент подключения ЕСА. Право даёт роль, а не факт входа.
//
// Сегодня сессия жителя (ЕСА) — своя подписанная cookie `vm_resident`, она не
// проходит через auth-стратегию Payload и в `req.user` не превращается; то есть
// дыры нет и не было. Правило приведено к роли на будущее, а не по инциденту.
export const authenticatedOrPublished: Access = ({ req: { user } }) => {
  const roles = user && Array.isArray(user.roles) ? user.roles : []
  if (roles.includes('admin') || roles.includes('editor')) return true

  return {
    _status: {
      equals: 'published',
    },
  }
}
