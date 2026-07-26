/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
import React from 'react'

import { formatPostDate } from '../../../lib/format'
import type { PostListItem, SectionDoc, MediaDoc } from '../../../lib/portal'

// Карточки ленты (M1): миниатюра-обложка, рубрика-ссылка, дата.
// feedExtras — баннеры зоны «в ленте», вставляются после каждого 5-го поста.

const FEED_BANNER_EVERY = 5

export function PostCard({ post, heading = 'h3' }: { post: PostListItem; heading?: 'h2' | 'h3' }) {
  const section = typeof post.section === 'object' && post.section ? (post.section as SectionDoc) : null
  const cover = typeof post.cover === 'object' && post.cover ? (post.cover as MediaDoc) : null
  const thumb = cover?.sizes?.card?.url || cover?.url || null
  const H = heading
  return (
    <li className="post-list__item post-card">
      {thumb ? (
        <Link
          className="post-card__thumb"
          href={`/news/${encodeURIComponent(post.slug ?? '')}`}
          tabIndex={-1}
          aria-hidden
        >
          <img src={thumb} alt="" loading="lazy" />
        </Link>
      ) : null}
      <div className="post-card__body">
        <H>
          <Link href={`/news/${encodeURIComponent(post.slug ?? '')}`}>
            {post.title || 'Без заголовка'}
          </Link>
        </H>
        <p className="post-list__meta">
          {formatPostDate(post.date || post.publishedAt)}
          {section?.slug ? (
            <>
              {' · '}
              <Link href={`/news/section/${encodeURIComponent(section.slug)}`}>
                {section.title}
              </Link>
            </>
          ) : post.category ? (
            ` · ${post.category}`
          ) : (
            ''
          )}
        </p>
      </div>
    </li>
  )
}

export function PostList({
  posts,
  heading = 'h3',
  feedExtras = [],
}: {
  posts: PostListItem[]
  heading?: 'h2' | 'h3'
  feedExtras?: React.ReactNode[]
}) {
  if (posts.length === 0) return <p className="muted">Пока нет новостей.</p>
  const items: React.ReactNode[] = []
  let extraIndex = 0
  posts.forEach((post, i) => {
    items.push(<PostCard key={post.id} post={post} heading={heading} />)
    if ((i + 1) % FEED_BANNER_EVERY === 0 && extraIndex < feedExtras.length) {
      items.push(
        <li key={`banner-${extraIndex}`} className="post-list__banner">
          {feedExtras[extraIndex]}
        </li>,
      )
      extraIndex += 1
    }
  })
  return <ul className="post-list">{items}</ul>
}

// Навигация по рубрикам (чипы) для ленты/главной/страницы рубрики.
export function SectionChips({
  sections,
  activeSlug,
}: {
  sections: SectionDoc[]
  activeSlug?: string
}) {
  if (sections.length === 0) return null
  return (
    <nav className="section-chips" aria-label="Рубрики">
      <Link className={!activeSlug ? 'is-active' : undefined} href="/news">
        Все
      </Link>
      {sections.map((section) =>
        section.slug ? (
          <Link
            key={section.id}
            className={section.slug === activeSlug ? 'is-active' : undefined}
            href={`/news/section/${encodeURIComponent(section.slug)}`}
          >
            {section.title}
          </Link>
        ) : null,
      )}
    </nav>
  )
}

// Пагинация «← Свежее / Страница N из M / Старше →» по статичным путям
// /news/page/[n] (ISR-friendly: без searchParams страница остаётся статичной).
export function Pagination({
  page,
  totalPages,
  makeHref,
}: {
  page: number
  totalPages: number
  makeHref: (page: number) => string
}) {
  if (totalPages <= 1) return null
  return (
    <nav className="pagination" aria-label="Страницы">
      {page > 1 ? <Link href={makeHref(page - 1)}>← Свежее</Link> : <span />}
      <span className="muted">
        Страница {page} из {totalPages}
      </span>
      {page < totalPages ? <Link href={makeHref(page + 1)}>Старше →</Link> : <span />}
    </nav>
  )
}
