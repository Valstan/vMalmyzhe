import { notFound } from 'next/navigation'

import { findPosts, getSectionBySlug, getSections, POSTS_PER_PAGE } from '../../../lib/portal'
import { getFeedBanners } from '../components/BannerSlot'
import { Pagination, PostList, SectionChips } from '../components/PostList'

// Лента новостей (M1): вся лента и лента рубрики, с пагинацией по статичным
// путям (/news/page/[n], /news/section/[slug]/page/[n]) — ISR-friendly.

export async function NewsView({
  sectionSlug,
  page = 1,
}: {
  sectionSlug?: string
  page?: number
} = {}) {
  const section = sectionSlug ? await getSectionBySlug(decodeURIComponent(sectionSlug)) : null
  if (sectionSlug && !section) notFound()

  const [sections, feedBanners, { docs, totalPages }] = await Promise.all([
    getSections(),
    getFeedBanners(),
    findPosts({ sectionId: section?.id, page, limit: POSTS_PER_PAGE }),
  ])
  if (page > 1 && docs.length === 0) notFound()

  const base = section ? `/news/section/${encodeURIComponent(section.slug ?? '')}` : '/news'

  return (
    <section>
      <h1>{section ? section.title : 'Новости'}</h1>
      {section?.description ? <p className="muted">{section.description}</p> : null}
      <SectionChips sections={sections} activeSlug={section?.slug ?? undefined} />
      <PostList posts={docs} heading="h2" feedExtras={feedBanners} />
      <Pagination
        page={page}
        totalPages={totalPages}
        makeHref={(n) => (n === 1 ? base : `${base}/page/${n}`)}
      />
    </section>
  )
}
