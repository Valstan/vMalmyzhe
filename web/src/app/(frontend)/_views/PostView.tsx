/* eslint-disable @next/next/no-img-element */
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import config from '@payload-config'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'

import { SITE_NAME, SITE_URL } from '../../../lib/site'
import { withRetry } from '../../../lib/withRetry'
import { RichText } from '../../../lib/RichText'
import { formatPostDate } from '../../../lib/format'
import type { MediaDoc, SectionDoc } from '../../../lib/portal'

type PostDoc = {
  title?: string | null
  slug?: string | null
  date?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
  category?: string | null
  section?: SectionDoc | number | null
  content?: unknown
  cover?: MediaDoc | string | number | null
  gallery?: (MediaDoc | number)[] | null
  source?: { vkPostId?: string | null; sourceUrl?: string | null } | null
}

async function getPost(slug: string): Promise<PostDoc | null> {
  return withRetry(async () => {
    const payload = await getPayload({ config })
    const res = await payload.find({
      collection: 'posts',
      where: { slug: { equals: slug }, _status: { equals: 'published' } },
      depth: 1,
      limit: 1,
    })
    return (res.docs[0] as PostDoc | undefined) ?? null
  })
}

// Плейн-текст из lexical-контента — для meta description (SEO #051).
function extractText(content: unknown, max = 200): string {
  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { text?: unknown; children?: unknown[] }
    if (typeof n.text === 'string') parts.push(n.text)
    if (Array.isArray(n.children)) n.children.forEach(walk)
  }
  walk((content as { root?: unknown } | null | undefined)?.root)
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export async function postMeta(slug: string): Promise<Metadata> {
  try {
    const post = await getPost(decodeURIComponent(slug))
    if (!post) return {}
    const cover = typeof post.cover === 'object' && post.cover ? (post.cover as MediaDoc) : null
    const description = extractText(post.content) || undefined
    const path = `/news/${encodeURIComponent(post.slug ?? '')}`
    return {
      title: post.title || SITE_NAME,
      description,
      alternates: { canonical: path },
      openGraph: {
        title: post.title || SITE_NAME,
        description,
        url: path,
        type: 'article',
        publishedTime: post.date || post.publishedAt || undefined,
        images: cover?.url ? [{ url: cover.url }] : undefined,
      },
    }
  } catch {
    return {}
  }
}

export async function PostView({ slug }: { slug: string }) {
  const post = await getPost(decodeURIComponent(slug))
  if (!post) notFound()

  const cover = typeof post.cover === 'object' && post.cover ? (post.cover as MediaDoc) : null
  const section =
    typeof post.section === 'object' && post.section ? (post.section as SectionDoc) : null
  // Галерея без дубля обложки: первое фото поста и есть cover (так кладёт ingest).
  const gallery = (post.gallery ?? [])
    .filter((item): item is MediaDoc => typeof item === 'object' && item !== null)
    .filter((item) => item.url && item.url !== cover?.url)
  const sourceUrl = post.source?.sourceUrl || null

  // JSON-LD NewsArticle (GEO/SEO #051): помогает поисковикам и LLM-агрегаторам
  // понять статью; адреса — абсолютные.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: post.title || undefined,
    datePublished: post.date || post.publishedAt || undefined,
    dateModified: post.updatedAt || undefined,
    image: cover?.url ? [`${SITE_URL}${cover.url}`] : undefined,
    articleSection: section?.title || undefined,
    mainEntityOfPage: `${SITE_URL}/news/${encodeURIComponent(post.slug ?? '')}`,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  }

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <h1>{post.title}</h1>
      <p className="post-list__meta">
        {formatPostDate(post.date || post.publishedAt)}
        {section?.slug ? (
          <>
            {' · '}
            <Link href={`/news/section/${encodeURIComponent(section.slug)}`}>{section.title}</Link>
          </>
        ) : post.category ? (
          ` · ${post.category}`
        ) : (
          ''
        )}
      </p>
      {cover?.url ? (
        <Image
          className="post-cover"
          src={cover.url}
          alt={cover.alt || post.title || ''}
          width={cover.width || 1200}
          height={cover.height || 675}
        />
      ) : null}
      <RichText data={post.content} />
      {gallery.length > 0 ? (
        <div className="post-gallery">
          {gallery.map((item, i) => (
            <img key={item.url ?? i} src={item.url!} alt={item.alt || ''} loading="lazy" />
          ))}
        </div>
      ) : null}
      {sourceUrl ? (
        <p className="post-source muted">
          Источник:{' '}
          <a href={sourceUrl} rel="nofollow noopener" target="_blank">
            «Малмыж-Инфо» ВКонтакте
          </a>
        </p>
      ) : null}
    </article>
  )
}
