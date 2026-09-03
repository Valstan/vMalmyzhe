import { describe, expect, it } from 'vitest'

import { authenticatedOrPublished } from './authenticatedOrPublished'

// Тип Access у Payload требует полный req; здесь важен только user, поэтому
// зовём правило через узкую обёртку — тест про логику, а не про типы Payload.
type User = { roles?: unknown } | null
const call = (user: User) =>
  (authenticatedOrPublished as unknown as (a: { req: { user: User } }) => unknown)({
    req: { user },
  })

const onlyPublished = { _status: { equals: 'published' } }

describe('authenticatedOrPublished — черновики только персоналу', () => {
  it('админ и редактор видят всё', () => {
    expect(call({ roles: ['admin'] })).toBe(true)
    expect(call({ roles: ['editor'] })).toBe(true)
  })

  it('гость — только опубликованное', () => {
    expect(call(null)).toEqual(onlyPublished)
  })

  // Главное в этом файле: «вошёл» ≠ «свой». Пользователь без роли персонала
  // черновиков не видит, даже если он полноценный user Payload.
  it('вошедший без роли персонала черновиков не видит', () => {
    expect(call({ roles: [] })).toEqual(onlyPublished)
    expect(call({ roles: ['resident'] })).toEqual(onlyPublished)
    expect(call({})).toEqual(onlyPublished)
    expect(call({ roles: 'admin' })).toEqual(onlyPublished)
  })
})
