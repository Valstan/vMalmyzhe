import { describe, expect, it } from 'vitest'

import { FAQ_ITEMS, faqJsonLd } from './faq'

describe('FAQ_ITEMS', () => {
  it('пять утверждённых вопросов без дублей и пустых ответов', () => {
    expect(FAQ_ITEMS).toHaveLength(5)
    const questions = FAQ_ITEMS.map((item) => item.q)
    expect(new Set(questions).size).toBe(questions.length)
    for (const item of FAQ_ITEMS) {
      expect(item.q.trim().length).toBeGreaterThan(0)
      expect(item.a.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('faqJsonLd', () => {
  it('строит FAQPage с теми же вопросами', () => {
    const graph = faqJsonLd()
    expect(graph['@type']).toBe('FAQPage')
    expect(graph.mainEntity).toHaveLength(FAQ_ITEMS.length)
    expect(graph.mainEntity[0]).toEqual({
      '@type': 'Question',
      name: FAQ_ITEMS[0].q,
      acceptedAnswer: { '@type': 'Answer', text: FAQ_ITEMS[0].a },
    })
  })
})
