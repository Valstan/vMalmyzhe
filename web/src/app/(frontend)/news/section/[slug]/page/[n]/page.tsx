import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getSectionBySlug } from '../../../../../../../lib/portal'
import { NewsView } from '../../../../../_views/NewsView'

// Пагинация рубрики: /news/section/[slug]/page/2, … ISR.
export const revalidate = 60

type Args = { params: Promise<{ slug: string; n: string }> }

export default async function SectionPageN({ params }: Args) {
  const { slug, n } = await params
  const page = Number(n)
  if (!Number.isInteger(page) || page < 2) notFound()
  return <NewsView sectionSlug={slug} page={page} />
}

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { slug, n } = await params
  const section = await getSectionBySlug(decodeURIComponent(slug))
  if (!section) return {}
  return { title: `${section.title} — страница ${n}` }
}
