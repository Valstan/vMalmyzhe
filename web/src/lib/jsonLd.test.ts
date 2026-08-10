import { describe, expect, it } from 'vitest'

import { jsonLdHtml } from './jsonLd'

// Тесты нарочно смотрят на строку, которая уходит в `__html`, а не на объект до
// сериализации: вторая половина G209 — как раз про тест, который разбирает
// данные вместо разметки и потому зелёный при дырявом выводе.
describe('jsonLdHtml', () => {
  const attack = '</script><script>alert(1)</script>'

  it('в разметке не остаётся ни одного сырого `<`', () => {
    const html = jsonLdHtml({ headline: attack, description: `a < b` })
    expect(html).not.toContain('<')
  })

  it('заголовок новости не может закрыть наш тег', () => {
    const html = jsonLdHtml({ '@type': 'NewsArticle', headline: attack })
    expect(html.toLowerCase()).not.toContain('</script')
  })

  it('экранирование обратимо: парсер получает исходный текст', () => {
    const html = jsonLdHtml({ headline: attack })
    expect(JSON.parse(html)).toEqual({ headline: attack })
  })

  it('демонстрация ловушки: проверка объекта прошла бы и на дырявом выводе', () => {
    const data = { headline: attack }
    const naive = JSON.stringify(data)
    // Разбор строки обратно в объект возвращает исходные данные — и у дырявого,
    // и у безопасного вывода. Отличаются они только как разметка.
    expect(JSON.parse(naive)).toEqual(data)
    expect(naive).toContain('</script')
    expect(jsonLdHtml(data)).not.toContain('</script')
  })
})
