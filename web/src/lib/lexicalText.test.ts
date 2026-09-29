import { describe, expect, it } from 'vitest'

import { extractText } from './lexicalText'

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
