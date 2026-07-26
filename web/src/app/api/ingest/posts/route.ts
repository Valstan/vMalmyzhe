import { timingSafeEqual } from 'crypto'
import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import config from '../../../../payload.config'

// Ingest-эндпойнт контент-конвейера (M0, news-portal-concept §3).
// Сарафан (шлюз #062) присылает пост из ВК «Малмыж-Инфо» POST'ом; сайт в ВК
// сам НЕ ходит. Защита — общий ключ GATEWAY_KEY_VMALMYZHE (#008, как Казанская).
//
// Контракт: POST /api/ingest/posts, заголовок X-Gateway-Key (или Bearer), JSON:
// {
//   vkPostId:  string   — обязателен, ключ идемпотентности (напр. "-12345_678")
//   sourceUrl: string   — обязателен, ссылка на оригинал в ВК (атрибуция, §9)
//   title?:    string   — если нет, берём начало текста
//   text?:     string   — plain text поста (абзацы через \n)
//   section?:  string   — slug рубрики (мапится классификатором setka)
//   date?:     string   — ISO-дата оригинального поста
//   images?:   Array<string | { url: string; alt?: string }> — медиа
//                        перекладываем к себе (ВК-CDN протухает, урок G56/G63)
// }
//
// Поведение: всегда draft (автопубликации нет до enforcing-метрики, mandate
// 07-26); повторная доставка того же vkPostId не дублирует — draft обновляется,
// published не трогается.

const MAX_IMAGES = 10
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000

const isAuthorized = (request: Request): boolean => {
  const key = process.env.GATEWAY_KEY_VMALMYZHE
  if (!key) return false
  const given =
    request.headers.get('x-gateway-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    ''
  const a = Buffer.from(given)
  const b = Buffer.from(key)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Плейн-текст → минимальный lexical richText (абзац на каждую непустую строку).
const textToLexical = (text: string) => ({
  root: {
    type: 'root',
    direction: null,
    format: '' as const,
    indent: 0,
    version: 1,
    children: text
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        type: 'paragraph',
        direction: null,
        format: '' as const,
        indent: 0,
        version: 1,
        children: [
          {
            type: 'text',
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: line,
            version: 1,
          },
        ],
      })),
  },
})

type IncomingImage = string | { url: string; alt?: string }

const extFromMime = (mime: string): string =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[mime] ??
  'jpg'

export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.GATEWAY_KEY_VMALMYZHE) {
    return NextResponse.json({ error: 'ingest is not configured' }, { status: 503 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: {
    vkPostId?: string
    sourceUrl?: string
    title?: string
    text?: string
    section?: string
    date?: string
    images?: IncomingImage[]
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const vkPostId = typeof body.vkPostId === 'string' ? body.vkPostId.trim() : ''
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const title =
    (typeof body.title === 'string' && body.title.trim()) ||
    (text ? `${text.slice(0, 80)}${text.length > 80 ? '…' : ''}` : '')

  if (!vkPostId) return NextResponse.json({ error: 'vkPostId is required' }, { status: 400 })
  if (!sourceUrl) return NextResponse.json({ error: 'sourceUrl is required' }, { status: 400 })
  if (!title) return NextResponse.json({ error: 'title or text is required' }, { status: 400 })

  const payload = await getPayload({ config })
  const warnings: string[] = []

  // Рубрика по slug от классификатора; неизвестный slug — не ошибка (draft
  // поправит оператор), но сигналим в ответе.
  let sectionId: number | undefined
  if (typeof body.section === 'string' && body.section.trim()) {
    const found = await payload.find({
      collection: 'sections',
      where: { slug: { equals: body.section.trim() } },
      limit: 1,
    })
    if (found.docs[0]) sectionId = found.docs[0].id
    else warnings.push(`unknown section slug: ${body.section.trim()}`)
  }

  // Идемпотентность по VK post-id: повторная доставка не создаёт дубль.
  const existing = await payload.find({
    collection: 'posts',
    where: { 'source.vkPostId': { equals: vkPostId } },
    draft: true,
    limit: 1,
  })
  const existingPost = existing.docs[0]

  if (existingPost && existingPost._status === 'published') {
    // Опубликованное руками не перетираем автоматикой.
    return NextResponse.json(
      { created: false, updated: false, id: existingPost.id, warnings },
      { status: 200 },
    )
  }

  // Медиа перекладываем к себе (не храним ВК-CDN-ссылки как основные).
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : []
  if (Array.isArray(body.images) && body.images.length > MAX_IMAGES) {
    warnings.push(`images truncated to ${MAX_IMAGES}`)
  }
  const mediaIds: number[] = []
  for (const [index, image] of images.entries()) {
    const url = typeof image === 'string' ? image : image?.url
    const alt = typeof image === 'object' && image?.alt ? image.alt : title
    if (!url || !/^https?:\/\//i.test(url)) {
      warnings.push(`image ${index}: invalid url`)
      continue
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
      if (!mime.startsWith('image/')) throw new Error(`not an image: ${mime}`)
      const data = Buffer.from(await response.arrayBuffer())
      if (data.length > MAX_IMAGE_BYTES) throw new Error(`too large: ${data.length} bytes`)
      const media = await payload.create({
        collection: 'media',
        data: { alt },
        file: {
          data,
          mimetype: mime,
          name: `vk-${vkPostId.replace(/[^\w-]/g, '_')}-${index}.${extFromMime(mime)}`,
          size: data.length,
        },
      })
      mediaIds.push(media.id)
    } catch (error) {
      warnings.push(`image ${index}: ${error instanceof Error ? error.message : 'fetch failed'}`)
    }
  }

  const data = {
    title,
    date: body.date || undefined,
    section: sectionId,
    content: text ? textToLexical(text) : undefined,
    cover: mediaIds[0],
    gallery: mediaIds.length ? mediaIds : undefined,
    source: { vkPostId, sourceUrl },
  }

  if (existingPost) {
    // Draft уже есть — обновляем содержимое (правки поста в ВК доезжают),
    // медиа при повторе не дублируем: новые файлы заменяют список целиком.
    const updated = await payload.update({
      collection: 'posts',
      id: existingPost.id,
      data: mediaIds.length ? data : { ...data, cover: undefined, gallery: undefined },
      draft: true,
    })
    return NextResponse.json(
      { created: false, updated: true, id: updated.id, warnings },
      { status: 200 },
    )
  }

  const created = await payload.create({
    collection: 'posts',
    data,
    draft: true,
  })
  return NextResponse.json({ created: true, id: created.id, warnings }, { status: 201 })
}
