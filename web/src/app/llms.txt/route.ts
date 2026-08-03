import config from '@payload-config'
import { getPayload } from 'payload'

import { SITE_DESC, SITE_NAME, SITE_URL } from '../../lib/site'

// /llms.txt — краткая карта сайта для языковых моделей (складывающийся стандарт
// llmstxt.org). Зачем отдельно от sitemap.xml: sitemap отдаёт голые адреса, а
// модели, отвечающие на вопрос «что происходит в Малмыже», выигрывают от
// готовой выжимки — что за сайт, какие разделы, какие свежие материалы и о чём
// каждый. Это дешёвый способ попасть в ответ, а не остаться списком ссылок.
//
// force-dynamic — как в sitemap: строим против реальной прод-БД, не запекаем.
export const dynamic = 'force-dynamic'

type PostDoc = {
  title?: string | null
  slug?: string | null
  date?: string | null
  publishedAt?: string | null
  content?: unknown
  section?: { title?: string | null } | number | null
}

// Первые осмысленные слова из lexical-контента — одной строкой.
const summarize = (content: unknown, limit = 180): string => {
  const root = (content as { root?: { children?: unknown[] } } | null)?.root
  if (!root?.children) return ''
  const out: string[] = []
  const walk = (nodes: unknown[]) => {
    for (const n of nodes as { type?: string; text?: string; children?: unknown[] }[]) {
      if (n?.type === 'text' && n.text) out.push(n.text)
      else if (Array.isArray(n?.children)) walk(n.children)
      if (out.join(' ').length > limit) return
    }
  }
  walk(root.children)
  const text = out.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
}

export async function GET(): Promise<Response> {
  const lines: string[] = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESC}`,
    '',
    'Городской портал Малмыжа и Малмыжского района Кировской области (Россия).',
    'Материалы на русском языке. Источник большинства новостей — сообщество',
    '«Малмыж-Инфо» ВКонтакте; на каждой новости стоит ссылка на оригинал.',
    '',
  ]

  try {
    const payload = await getPayload({ config })

    const sections = await payload.find({
      collection: 'sections',
      depth: 0,
      limit: 100,
      pagination: false,
    })
    if (sections.docs.length) {
      lines.push('## Разделы', '')
      for (const s of sections.docs as { title?: string | null; slug?: string | null }[]) {
        if (!s.slug) continue
        lines.push(`- [${s.title ?? s.slug}](${SITE_URL}/news/section/${encodeURIComponent(s.slug)})`)
      }
      lines.push('')
    }

    const posts = await payload.find({
      collection: 'posts',
      where: { _status: { equals: 'published' } },
      sort: '-date',
      depth: 1,
      limit: 50,
    })
    if (posts.docs.length) {
      lines.push('## Свежие материалы', '')
      for (const p of posts.docs as PostDoc[]) {
        if (!p.slug) continue
        const date = (p.date || p.publishedAt || '').slice(0, 10)
        const section =
          typeof p.section === 'object' && p.section?.title ? ` · ${p.section.title}` : ''
        const summary = summarize(p.content)
        lines.push(
          `- [${p.title ?? p.slug}](${SITE_URL}/news/${encodeURIComponent(p.slug)})` +
            ` — ${date}${section}${summary ? `. ${summary}` : ''}`,
        )
      }
      lines.push('')
    }
  } catch (e) {
    console.error('[llms.txt] query failed:', e)
  }

  lines.push('## Ещё', '', `- [Все новости](${SITE_URL}/news)`, `- [Поиск](${SITE_URL}/search)`, '')

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=900, stale-while-revalidate=3600',
    },
  })
}
