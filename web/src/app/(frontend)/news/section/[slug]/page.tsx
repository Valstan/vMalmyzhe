import type { Metadata } from 'next'

import { getSectionBySlug } from '../../../../../lib/portal'
import { NewsView } from '../../../_views/NewsView'

// Страница рубрики: /news/section/[slug] (M1). Статичный сегмент section
// выигрывает у динамического /news/[slug] — коллизий с постами нет. ISR.
export const revalidate = 60

type Args = { params: Promise<{ slug: string }> }

export default async function SectionPage({ params }: Args) {
  const { slug } = await params
  return <NewsView sectionSlug={slug} />
}

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { slug } = await params
  const section = await getSectionBySlug(decodeURIComponent(slug))
  if (!section) return {}
  return {
    title: section.title,
    description: section.description || undefined,
    alternates: { canonical: `/news/section/${encodeURIComponent(section.slug ?? '')}` },
  }
}
