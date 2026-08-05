import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import config from '../../../../payload.config'
import {
  buildPostData,
  normalizeVideos,
  secretMatches,
  type IncomingVideo,
} from '../../../../lib/ingest'

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
//   videos?:   Array<string | { url: string; title?: string }> — видео НЕ
//                        перекладываем: ссылка на плеер ВК встраивается в текст
//                        (RichText рендерит iframe video_ext.php; решение
//                        владельца 05.08 — без тяжёлых файлов у нас)
//   publishedAt?: string — дата публикации; если не передана, Payload проставит
//                        текущую (hook populatePublishedAt)
//   publish?:  boolean  — ЯВНАЯ публикация вместо draft, см. ниже
// }
//
// Поведение: по умолчанию draft (автопубликации нет до enforcing-метрики,
// mandate 07-26) — автоматический конвейер Сарафана флаг не шлёт, и эта гарантия
// для него сохраняется без изменений. `publish: true` — осознанное действие
// оператора, заведено по прямому заказу владельца 08-03 (наполнение портала из
// «Малмыж-Инфо» силами сессии).
//
// ⚠️ Публикация требует ВТОРОГО секрета `INGEST_PUBLISH_KEY` в заголовке
// `X-Publish-Key` (#107, предупреждение brain в G211-письме 07-31): общий ключ
// шлюза доказывает, что предъявитель — «шлюз», и ничего не доказывает про право
// публиковать. Пока ingest был всегда-draft, это гасилось конструктивно; с
// появлением флага «всегда draft» перестал быть последней линией, поэтому
// способность публиковать отделена от способности присылать. Ключа нет или он
// неверен — пост всё равно создаётся, но черновиком, и в ответ идёт warning
// (деградация безопасная, доставка контента не теряется).
// Повторная доставка того же vkPostId не дублирует — draft обновляется,
// published не трогается. Рубрика при повторе не перезаписывается — она
// принадлежит редактору; пустая дозаполняется (#095).

type IncomingImage = string | { url: string; alt?: string }

const MAX_IMAGES = 10
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000

// Право публиковать — отдельный секрет, не тот, которым авторизуется доставка.
const mayPublish = (request: Request): boolean =>
  secretMatches(request.headers.get('x-publish-key') ?? '', process.env.INGEST_PUBLISH_KEY)

const isAuthorized = (request: Request): boolean => {
  const given =
    request.headers.get('x-gateway-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    ''
  return secretMatches(given, process.env.GATEWAY_KEY_VMALMYZHE)
}

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
    videos?: IncomingVideo[]
    publishedAt?: string
    publish?: boolean
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
  let publish = body.publish === true
  if (publish && !mayPublish(request)) {
    publish = false
    warnings.push('publish ignored: valid X-Publish-Key required, saved as draft')
  }
  const videos = normalizeVideos(body.videos, warnings)

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

  const data = buildPostData({
    title,
    text,
    vkPostId,
    sourceUrl,
    publish,
    videos,
    mediaIds,
    date: body.date,
    publishedAt: body.publishedAt,
    sectionId,
  })

  if (existingPost) {
    // Draft уже есть — обновляем содержимое (правки поста в ВК доезжают),
    // медиа при повторе не дублируем: новые файлы заменяют список целиком.
    //
    // Рубрику при повторе НЕ перезаписываем (#095, проверка слоёв 07-28):
    // классификатор даёт догадку, дальше поле принадлежит редактору — иначе
    // ручное исправление мисклассификации откатывается следующей же доставкой
    // того же vkPostId. Пустую рубрику дозаполнить можно: так пост, приехавший
    // с ещё не заведённым slug'ом, получит её, когда рубрика появится.
    const updated = await payload.update({
      collection: 'posts',
      id: existingPost.id,
      data: {
        ...data,
        section: existingPost.section ? undefined : sectionId,
        ...(mediaIds.length ? {} : { cover: undefined, gallery: undefined }),
      },
      draft: !publish,
    })
    return NextResponse.json(
      { created: false, updated: true, published: publish, id: updated.id, warnings },
      { status: 200 },
    )
  }

  const created = await payload.create({
    collection: 'posts',
    data,
    draft: !publish,
  })
  return NextResponse.json(
    { created: true, published: publish, id: created.id, warnings },
    { status: 201 },
  )
}
