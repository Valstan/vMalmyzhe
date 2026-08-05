import { describe, expect, it } from 'vitest'

import { buildContent, buildPostData, normalizeVideos, secretMatches } from './ingest'

// Тесты написаны по следам двух багов, доехавших до прода 2026-08-03 через
// полностью зелёные lint и typecheck (ревизия гейтов #104). Каждый блок ниже —
// не «покрытие ради покрытия», а конкретная поломка, которую гейт не поймал.

const base = {
  title: 'Заголовок',
  text: 'Первый абзац.\nВторой абзац.',
  vkPostId: '-1_2',
  sourceUrl: 'https://vk.com/wall-1_2',
  videos: [],
  mediaIds: [],
}

describe('публикация: _status, а не только draft', () => {
  // Баг №1: `payload.create({ draft: false })` НЕ публикует — при
  // versions.drafts состояние берётся из data._status. Пост молча оставался
  // черновиком при HTTP 201, публичный API отдавал totalDocs: 0.
  it('publish=true проставляет _status: published', () => {
    const data = buildPostData({ ...base, publish: true })
    expect(data._status).toBe('published')
  })

  it('publish=false не проставляет _status вовсе — остаётся черновик', () => {
    const data = buildPostData({ ...base, publish: false })
    expect(data).not.toHaveProperty('_status')
  })
})

describe('право публиковать отделено от права присылать', () => {
  // Баг №2: флаг publish принимался у любого держателя ключа доставки —
  // общий ключ доказывает «я шлюз», а не «мне можно публиковать» (#107).
  it('пустой заголовок не даёт права', () => {
    expect(secretMatches('', 'настоящий-секрет')).toBe(false)
  })

  it('неверный секрет не даёт права', () => {
    expect(secretMatches('подделка', 'настоящий-секрет')).toBe(false)
  })

  it('ненастроенный секрет на сервере не даёт права никому', () => {
    // Иначе пустой env превратился бы в «пускать всех».
    expect(secretMatches('что угодно', undefined)).toBe(false)
    expect(secretMatches('', undefined)).toBe(false)
  })

  it('верный секрет даёт право', () => {
    expect(secretMatches('настоящий-секрет', 'настоящий-секрет')).toBe(true)
  })
})

describe('даты: публикуем датой оригинала, а не сегодняшней', () => {
  const date = '2026-07-31T09:20:00.000Z'

  it('publishedAt берётся из присланного значения', () => {
    const data = buildPostData({ ...base, publish: true, date, publishedAt: date })
    expect(data.publishedAt).toBe(date)
    expect(data.date).toBe(date)
  })

  it('без publishedAt подставляется дата новости, а не «сейчас»', () => {
    // Пусто → хук populatePublishedAt проставил бы текущую дату, и новость
    // трёхдневной давности выглядела бы свежей.
    const data = buildPostData({ ...base, publish: true, date })
    expect(data.publishedAt).toBe(date)
  })
})

describe('видео', () => {
  it('ссылка на плеер становится узлом link, который умеет рендерить RichText', () => {
    const content = buildContent('Текст.', [{ url: 'https://vk.com/video-1_2', title: 'Ролик' }])
    const nodes = content.root.children
    const last = nodes.at(-1) as unknown as {
      children: { type: string; fields?: { url?: string } }[]
    }
    const link = last.children.find((c) => c.type === 'link')
    expect(link?.fields?.url).toBe('https://vk.com/video-1_2')
  })

  it('абзацы текста сохраняются и видео идёт после них', () => {
    const content = buildContent('Раз.\nДва.', [{ url: 'https://vk.com/video-1_2' }])
    expect(content.root.children).toHaveLength(3)
  })

  it('мусорные ссылки отбрасываются с предупреждением, а не роняют импорт', () => {
    const warnings: string[] = []
    const videos = normalizeVideos(['не-ссылка', 'https://vk.com/video-1_2'], warnings)
    expect(videos).toHaveLength(1)
    expect(warnings[0]).toContain('invalid url')
  })

  it('число видео ограничено', () => {
    const warnings: string[] = []
    const many = Array.from({ length: 9 }, (_, i) => `https://vk.com/video-1_${i}`)
    expect(normalizeVideos(many, warnings)).toHaveLength(5)
    expect(warnings.join()).toContain('truncated')
  })
})

describe('медиа не перетекают между новостями', () => {
  it('обложка — первый файл своего поста, галерея — ровно его список', () => {
    const data = buildPostData({ ...base, publish: true, mediaIds: [11, 12, 13] })
    expect(data.cover).toBe(11)
    expect(data.gallery).toEqual([11, 12, 13])
  })

  it('без медиа поля пустые, а не унаследованные', () => {
    const data = buildPostData({ ...base, publish: true })
    expect(data.cover).toBeUndefined()
    expect(data.gallery).toBeUndefined()
  })
})

describe('картинки встраиваются в текст, а не копятся в конце (заказ владельца 05.08)', () => {
  it('первое медиа — обложка, в текст не дублируется; остальные — upload-узлами', () => {
    const content = buildContent('Раз.\nДва.', [], [11, 12, 13])
    const nodes = content.root.children
    // абзац, upload(12), абзац, upload(13) — обложка 11 остаётся только cover
    expect(nodes.map((n) => n.type)).toEqual(['paragraph', 'upload', 'paragraph', 'upload'])
    const uploads = nodes.filter((n) => n.type === 'upload') as unknown as {
      fields: { value: number }
    }[]
    expect(uploads.map((u) => u.fields.value)).toEqual([12, 13])
  })

  it('картинки распределяются между абзацами равномерно', () => {
    const content = buildContent('Один.\nДва.\nТри.', [], [11, 12, 13])
    const nodes = content.root.children
    expect(nodes.map((n) => n.type)).toEqual([
      'paragraph',
      'upload',
      'paragraph',
      'upload',
      'paragraph',
    ])
  })

  it('одно фото (только обложка) — upload-узлов в тексте нет', () => {
    const content = buildContent('Текст.', [], [11])
    expect(content.root.children.map((n) => n.type)).toEqual(['paragraph'])
  })

  it('медиа из чужого поста в текст не попадают: вставляются только свои', () => {
    const data = buildPostData({ ...base, publish: true, mediaIds: [11, 12] })
    const content = data.content as { root: { children: { type?: string; fields?: { value?: number } }[] } }
    const uploads = content.root.children.filter((n) => n.type === 'upload')
    expect(uploads.map((u) => u.fields?.value)).toEqual([12])
  })
})
