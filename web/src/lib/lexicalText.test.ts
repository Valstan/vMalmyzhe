import { describe, expect, it } from 'vitest'

import { extractText, metaDescription } from './lexicalText'
import { SITE_DESC } from './site'

const doc = (...texts: string[]) => ({
  root: {
    children: texts.map((text) => ({
      type: 'paragraph',
      children: [{ type: 'text', text }],
    })),
  },
})

describe('extractText', () => {
  it('склеивает текстовые узлы в одну строку', () => {
    expect(extractText(doc('Малмыж', 'новости'))).toBe('Малмыж новости')
  })

  it('схлопывает пробелы и переносы', () => {
    expect(extractText(doc('а  б\nв'))).toBe('а б в')
  })

  it('обрезает длинный текст с многоточием', () => {
    const long = 'x'.repeat(300)
    const out = extractText(doc(long), 200)
    expect(out).toHaveLength(200)
    expect(out.endsWith('…')).toBe(true)
  })

  it('пустой и чужой вход дают пустую строку', () => {
    expect(extractText(null)).toBe('')
    expect(extractText({ root: {} })).toBe('')
    expect(extractText('строка')).toBe('')
  })
})

describe('metaDescription (мандат 01.10, Р1)', () => {
  it('обычный текст проходит как есть', () => {
    expect(metaDescription(doc('Новости Малмыжа'))).toBe('Новости Малмыжа')
  })

  it('длинный текст срезан до 200 символов', () => {
    const out = metaDescription(doc('x'.repeat(300)))
    expect([...out].length).toBeLessThanOrEqual(200)
  })

  it('пустой контент даёт явный SITE_DESC, а не пустоту', () => {
    expect(metaDescription(null)).toBe(SITE_DESC)
    expect(metaDescription({ root: {} })).toBe(SITE_DESC)
  })
})
