import config from '@payload-config'
import { getPayload } from 'payload'

import { SITE_DESC, SITE_NAME, SITE_URL } from '../../lib/site'

// /rss.xml — лента новостей. Нужна не столько людям, сколько машинам: агрегаторы
// и краулеры (в том числе тех, кто наполняет ответы нейросетей) забирают свежее
// именно так, не выкачивая сайт целиком. Для новостного портала это самый
// дешёвый канал регулярной индексации.
export const dynamic = 'force-dynamic'

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

type PostDoc = {
  title?: string | null
  slug?: string | null
  date?: string | null
  publishedAt?: string | null
  content?: unknown
  section?: { title?: string | null } | number | null
}

const plainText = (content: unknown, limit = 400): string => {
  const root = (content as { root?: { children?: unknown[] } } | null)?.root
  if (!root?.children) return ''
  const out: string[] = []
  const walk = (nodes: unknown[]) => {
    for (const n of nodes as { type?: string; text?: string; children?: unknown[] }[]) {
      if (n?.type === 'text' && n.text) out.push(n.text)
      else if (Array.isArray(n?.children)) walk(n.children)
    }
  }
  walk(root.children)
  const text = out.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
}

export async function GET(): Promise<Response> {
  const items: string[] = []

  try {
    const payload = await getPayload({ config })
    const posts = await payload.find({
      collection: 'posts',
      where: { _status: { equals: 'published' } },
      sort: '-date',
      depth: 1,
      limit: 50,
    })

    for (const p of posts.docs as PostDoc[]) {
      if (!p.slug) continue
      const url = `${SITE_URL}/news/${encodeURIComponent(p.slug)}`
      const stamp = p.date || p.publishedAt
      const category =
        typeof p.section === 'object' && p.section?.title
          ? `\n      <category>${escape(p.section.title)}</category>`
          : ''
      items.push(
        `    <item>
      <title>${escape(p.title ?? '')}</title>
      <link>${escape(url)}</link>
      <guid isPermaLink="true">${escape(url)}</guid>${category}
      ${stamp ? `<pubDate>${new Date(stamp).toUTCString()}</pubDate>` : ''}
      <description>${escape(plainText(p.content))}</description>
    </item>`,
      )
    }
  } catch (e) {
    console.error('[rss] query failed:', e)
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escape(SITE_NAME)}</title>
    <link>${escape(SITE_URL)}</link>
    <description>${escape(SITE_DESC)}</description>
    <language>ru</language>
    <atom:link href="${escape(`${SITE_URL}/rss.xml`)}" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>
`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=900, stale-while-revalidate=3600',
    },
  })
}
