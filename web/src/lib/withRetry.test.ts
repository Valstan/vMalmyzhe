import { afterEach, describe, expect, it, vi } from 'vitest'

import { degraded, withRetry } from './withRetry'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('withRetry', () => {
  it('успех с первой попытки — без пауз и без повторов', async () => {
    const fn = vi.fn(async () => 'ok')
    await expect(withRetry(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('транзиент гасится: падает дважды, на третьей отдаёт результат', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n += 1
      if (n < 3) throw new Error('reset')
      return n
    })
    await expect(withRetry(fn, { baseMs: 0 })).resolves.toBe(3)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('исчерпав попытки, пробрасывает ПОСЛЕДНЮЮ ошибку, а не первую', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n += 1
      throw new Error(`попытка ${n}`)
    })
    await expect(withRetry(fn, { tries: 3, baseMs: 0 })).rejects.toThrow('попытка 3')
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

describe('degraded — деградация не должна быть немой', () => {
  it('отдаёт запасное значение и пишет строку в журнал', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(degraded('portal/getSections', [], new Error('пул исчерпан'))).toEqual([])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0][0])).toContain('portal/getSections')
    expect(spy.mock.calls[0][1]).toBe('пул исчерпан')
  })

  it('не-Error тоже попадает в журнал, а не теряется', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(degraded('x', null, 'строка вместо ошибки')).toBeNull()
    expect(spy.mock.calls[0][1]).toBe('строка вместо ошибки')
  })

  it('в журнал идёт сообщение, а не сам объект ошибки со стеком и данными', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('connect ECONNREFUSED')
    degraded('portal/findPosts', { docs: [], totalPages: 0, totalDocs: 0 }, err)
    expect(spy.mock.calls[0][1]).toBe('connect ECONNREFUSED')
    expect(spy.mock.calls[0][1]).not.toBe(err)
  })
})
