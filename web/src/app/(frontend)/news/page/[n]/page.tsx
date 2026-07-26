import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { NewsView } from '../../../_views/NewsView'

// Пагинация ленты: /news/page/2, /news/page/3, … (страница 1 — сам /news). ISR.
export const revalidate = 60

type Args = { params: Promise<{ n: string }> }

export default async function NewsPageN({ params }: Args) {
  const { n } = await params
  const page = Number(n)
  if (!Number.isInteger(page) || page < 2) notFound()
  return <NewsView page={page} />
}

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { n } = await params
  return { title: `Новости — страница ${n}` }
}
