import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { middleware } from './middleware'

// Легаси-адреса Вордпресса отдавали копию главной с 200 и попадали в индекс
// Яндекса как «Неканонические» (Вебмастер, 31.10). Теперь — 301 на главную.
const call = (url: string) => middleware(new NextRequest(url))

describe('middleware: легаси-параметры Вордпресса', () => {
  it.each(['p', 'm', 'paged', 'attachment_id', 'replytocom', 's'])(
    '?%s=… → 301 на главную без параметров',
    (key) => {
      const res = call(`https://example.test/?${key}=2996`)

      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toBe('https://example.test/')
    },
  )

  it('utm-метки не трогает', () => {
    const res = call('https://example.test/?utm_source=vk&utm_campaign=news')

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })
})
