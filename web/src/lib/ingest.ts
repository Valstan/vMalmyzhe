import { timingSafeEqual } from 'crypto'

// Чистая логика ingest-конвейера, вынесенная из route.ts, чтобы её можно было
// проверить тестами без БД и HTTP. Причина конкретная: 2026-08-03 два бага
// проехали на прод через полностью зелёные lint и typecheck —
//   1) `draft: false` не публикует, состояние берётся из `_status`;
//   2) флаг publish принимался у любого держателя ключа доставки.
// Ни один из них не выражается в системе типов; ловится только поведенческой
// проверкой (ревизия гейтов #104).

export type LexNode = { [k: string]: unknown; type: string; version: number }

export const MAX_VIDEOS = 5

export const textNode = (text: string): LexNode => ({
  type: 'text',
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text,
  version: 1,
})

export const paragraph = (children: LexNode[]): LexNode => ({
  type: 'paragraph',
  direction: null,
  format: '' as const,
  indent: 0,
  version: 1,
  children,
})

// Ссылка на плеер ВК: узел `link` — RichText.tsx его рендерит как <a>.
export const videoParagraph = (url: string, title?: string): LexNode =>
  paragraph([
    textNode('🎬 Видео: '),
    {
      type: 'link',
      direction: null,
      format: '' as const,
      indent: 0,
      version: 3,
      fields: { url, newTab: true, linkType: 'custom' },
      children: [textNode(title?.trim() || 'смотреть во ВКонтакте')],
    },
  ])

// Плейн-текст + видео → минимальный lexical richText (абзац на непустую строку,
// ссылки на видео — в конец, в том же порядке, в каком пришли из своего поста).
export const buildContent = (text: string, videos: { url: string; title?: string }[]) => {
  const children: LexNode[] = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => paragraph([textNode(line)]))

  for (const video of videos) children.push(videoParagraph(video.url, video.title))

  return {
    root: {
      type: 'root',
      direction: null,
      format: '' as const,
      indent: 0,
      version: 1,
      children,
    },
  }
}

export type IncomingVideo = string | { url: string; title?: string }

// Видео приходят ссылками на плеер ВК — нормализуем и отбрасываем мусор.
export const normalizeVideos = (
  raw: unknown,
  warnings: string[],
): { url: string; title?: string }[] => {
  if (!Array.isArray(raw)) return []
  const videos: { url: string; title?: string }[] = []
  for (const [index, item] of (raw as IncomingVideo[]).entries()) {
    if (videos.length >= MAX_VIDEOS) {
      warnings.push(`videos truncated to ${MAX_VIDEOS}`)
      break
    }
    const url = typeof item === 'string' ? item : item?.url
    if (!url || !/^https?:\/\//i.test(url)) {
      warnings.push(`video ${index}: invalid url`)
      continue
    }
    videos.push({ url, title: typeof item === 'object' ? item?.title : undefined })
  }
  return videos
}

// Constant-time сравнение секрета из заголовка с ожидаемым.
export const secretMatches = (given: string, expected: string | undefined): boolean => {
  if (!expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type PostDataInput = {
  title: string
  text: string
  vkPostId: string
  sourceUrl: string
  publish: boolean
  videos: { url: string; title?: string }[]
  mediaIds: number[]
  date?: string
  publishedAt?: string
  sectionId?: number
}

// Тело документа для payload.create/update.
//
// ⚠️ `_status` здесь не украшение: при включённых versions.drafts Payload берёт
// состояние документа именно отсюда, а аргумент `draft` сам по себе НЕ
// публикует. Без этой строки пост молча остаётся черновиком при HTTP 201.
export const buildPostData = (input: PostDataInput) => ({
  ...(input.publish ? { _status: 'published' as const } : {}),
  title: input.title,
  date: input.date || undefined,
  // Дата публикации = дата оригинала, если её прислали: иначе хук
  // populatePublishedAt проставит «сегодня», и трёхдневная новость
  // выглядела бы свежей.
  publishedAt: input.publishedAt || input.date || undefined,
  section: input.sectionId,
  content: input.text || input.videos.length ? buildContent(input.text, input.videos) : undefined,
  cover: input.mediaIds[0],
  gallery: input.mediaIds.length ? input.mediaIds : undefined,
  source: { vkPostId: input.vkPostId, sourceUrl: input.sourceUrl },
})
