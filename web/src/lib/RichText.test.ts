import { describe, expect, it } from 'vitest'
import { resolveUploadUrl, vkEmbedUrl } from './RichText'

describe('resolveUploadUrl', () => {
  it('payload3: relationTo/value на уровне узла, value — id', () => {
    const node = { type: 'upload', version: 3, relationTo: 'media', value: 12 }
    expect(resolveUploadUrl(node, { '12': '/api/media/file/a.jpg' })).toBe('/api/media/file/a.jpg')
  })

  it('payload3 с population: value — объект медиа', () => {
    const node = {
      type: 'upload',
      version: 3,
      relationTo: 'media',
      value: { id: 88, url: '/api/media/file/b.jpg' },
    }
    expect(resolveUploadUrl(node, { '88': '/api/media/file/map.jpg' })).toBe(
      '/api/media/file/map.jpg',
    )
    expect(resolveUploadUrl(node)).toBe('/api/media/file/b.jpg')
  })

  it('payload2: relationTo/value внутри fields', () => {
    const node = { type: 'upload', version: 2, fields: { relationTo: 'media', value: 7 } }
    expect(resolveUploadUrl(node, { '7': '/api/media/file/c.jpg' })).toBe('/api/media/file/c.jpg')
  })

  it('не media или без value → null', () => {
    expect(resolveUploadUrl({ type: 'upload', relationTo: 'other', value: 1 })).toBeNull()
    expect(resolveUploadUrl({ type: 'upload', relationTo: 'media' })).toBeNull()
    expect(resolveUploadUrl({ type: 'paragraph' })).toBeNull()
  })
})

describe('vkEmbedUrl', () => {
  it('ссылка на видео ВК → iframe-адрес', () => {
    expect(vkEmbedUrl('https://vk.com/video-158787639_456239048')).toBe(
      'https://vk.com/video_ext.php?oid=-158787639&id=456239048',
    )
  })
  it('player-URL с hash оставляет как есть', () => {
    const u = 'https://vk.com/video_ext.php?oid=-158787639&id=456239048&hash=abc123'
    expect(vkEmbedUrl(u)).toBe(u)
  })
  it('не-VK ссылка → null', () => {
    expect(vkEmbedUrl('https://example.com/video')).toBeNull()
  })
})
