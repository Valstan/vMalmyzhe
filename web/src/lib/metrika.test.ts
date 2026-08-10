import { describe, expect, it } from 'vitest'

import { normalizeMetrikaId } from './metrika'

describe('normalizeMetrikaId', () => {
  it('нормальный номер счётчика проходит', () => {
    expect(normalizeMetrikaId('98765432')).toBe('98765432')
    expect(normalizeMetrikaId('  98765432 ')).toBe('98765432')
  })

  it('пусто и не задано → пусто (счётчик не рендерится)', () => {
    expect(normalizeMetrikaId(undefined)).toBe('')
    expect(normalizeMetrikaId('')).toBe('')
  })

  it('всё, что не цифры, отбрасывается — в том числе попытка выйти из script', () => {
    expect(normalizeMetrikaId('123");</script><script>alert(1)//')).toBe('')
    expect(normalizeMetrikaId('ID-счётчика')).toBe('')
  })
})
