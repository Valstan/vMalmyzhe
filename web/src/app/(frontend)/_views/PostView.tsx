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
import { PostGallery } from '../components/PostGallery'
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

// Есть ли картинки, встроенные в текст (upload-узлы)? Новые посты (с 05.08)
// ingest кладёт фото внутрь текста; старые — только в gallery скопом в конце.
function hasInlineMedia(content: unknown): boolean {
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false
    const n = node as { type?: unknown; children?: unknown[] }
    if (n.type === 'upload') return true
    if (Array.isArray(n.children)) return n.children.some(walk)
    return false
  }
  return walk((content as { root?: unknown } | null | undefined)?.root)
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
  const allMedia = (post.gallery ?? []).filter(
    (item): item is MediaDoc => typeof item === 'object' && item !== null,
  )
  // mediaMap: id медиа → url — для картинок внутри текста (RichText не умеет
  // резолвить upload-узлы сам).
  const mediaMap: Record<string, string | undefined> = {}
  for (const m of allMedia) {
    if (m.id != null && m.url) mediaMap[String(m.id)] = m.url
  }
  if (cover?.id != null && cover.url) mediaMap[String(cover.id)] = cover.url
  // Галерея-скоп в конце: только для старых постов, где фото не встроены в текст.
  const tailGallery = hasInlineMedia(post.content)
    ? []
    : allMedia.filter((item) => item.url && item.url !== cover?.url)
  const sourceUrl = post.source?.sourceUrl || null

  // JSON-LD NewsArticle (GEO/SEO #051): помогает поисковикам и LLM-агрегаторам
  // понять статью; адреса — абсолютные.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: post.title || undefined,
    // Аннотация: то, что модель процитирует, если возьмёт материал в ответ.
    description: extractText(post.content)?.slice(0, 300) || undefined,
    datePublished: post.date || post.publishedAt || undefined,
    dateModified: post.updatedAt || undefined,
    image: cover?.url ? [`${SITE_URL}${cover.url}`] : undefined,
    articleSection: section?.title || undefined,
    inLanguage: 'ru-RU',
    isAccessibleForFree: true,
    // Кто отвечает за материал — отдельно от того, кто его издал.
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@type': 'NewsMediaOrganization', name: SITE_NAME, url: SITE_URL },
    mainEntityOfPage: `${SITE_URL}/news/${encodeURIComponent(post.slug ?? '')}`,
    // Атрибуция первоисточника машиночитаемо, а не только текстом на странице.
    ...(sourceUrl ? { isBasedOn: sourceUrl } : {}),
    // Привязка к месту: запрос «что нового в Малмыже» должен находить именно нас.
    contentLocation: {
      '@type': 'Place',
      name: 'Малмыж, Малмыжский район, Кировская область, Россия',
    },
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
          data-post-media
        />
      ) : null}
      <div className="post-content">
        <RichText data={post.content} mediaMap={mediaMap} />
      </div>
      {tailGallery.length > 0 ? (
        <div className="post-gallery">
          {tailGallery.map((item, i) => (
            <img
              key={item.url ?? i}
              src={item.url!}
              alt={item.alt || ''}
              loading="lazy"
              data-post-media
            />
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
      <PostGallery />
    </article>
  )
}
