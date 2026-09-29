import type { Metadata } from 'next'
import config from '@payload-config'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'

import { SITE_NAME } from '../../../lib/site'
import { degraded, withRetry } from '../../../lib/withRetry'
import { extractText } from '../../../lib/lexicalText'
import { RichText } from '../../../lib/RichText'

type PageDoc = {
  title?: string | null
  content?: unknown
}

async function getPage(slug: string): Promise<PageDoc | null> {
  return withRetry(async () => {
    const payload = await getPayload({ config })
    const res = await payload.find({
      collection: 'pages',
      where: { slug: { equals: slug }, _status: { equals: 'published' } },
      depth: 0,
      limit: 1,
    })
    return (res.docs[0] as PageDoc | undefined) ?? null
  })
}

export async function pageMeta(slug: string): Promise<Metadata> {
  try {
    const page = await getPage(slug)
    if (!page) return {}
    // Description из первого абзаца — иначе страница наследует общий SITE_DESC
    // и Вебмастер видит дубли (замечание 29.09, D-088 п.3).
    return { title: page.title || SITE_NAME, description: extractText(page.content) || undefined }
  } catch (err) {
    return degraded('PageView/pageMeta', {}, err)
  }
}

export async function PageView({ slug }: { slug: string }) {
  // Сбой чтения пробрасываем (не кэшируем ложный 404 под ISR); реальное
  // отсутствие → notFound().
  const page = await getPage(decodeURIComponent(slug))
  if (!page) notFound()

  return (
    <article>
      <h1>{page.title}</h1>
      <RichText data={page.content} />
    </article>
  )
}
