import config from '@payload-config'
import { getPayload, type Where } from 'payload'

import { degraded, withRetry } from './withRetry'

// Данные портала (M1): рубрики, активные баннеры, выборки постов.
// Все функции мягко деградируют ([]/null) — сбой одной секции не роняет страницу
// (паттерн withRetry, см. комментарий в withRetry.ts). Detail-выборка поста —
// в PostView (там сбой должен кидать, а не давать ложный 404).

export type SectionDoc = {
  id: number
  title?: string | null
  slug?: string | null
  description?: string | null
  order?: number | null
}

export type MediaDoc = {
  id?: string | number
  url?: string | null
  alt?: string | null
  width?: number | null
  height?: number | null
  sizes?: { card?: { url?: string | null } | null } | null
}

export type PostListItem = {
  id: string | number
  title?: string | null
  slug?: string | null
  date?: string | null
  publishedAt?: string | null
  category?: string | null
  section?: SectionDoc | number | null
  cover?: MediaDoc | number | null
}

export type BannerDoc = {
  id: number
  title?: string | null
  zone?: 'header' | 'sidebar' | 'feed' | null
  image?: MediaDoc | number | null
  link?: string | null
}

export const POSTS_PER_PAGE = 20

export async function getSections(): Promise<SectionDoc[]> {
  try {
    return await withRetry(async () => {
      const payload = await getPayload({ config })
      const res = await payload.find({
        collection: 'sections',
        sort: 'order',
        depth: 0,
        limit: 50,
        pagination: false,
      })
      return res.docs as SectionDoc[]
    })
  } catch (err) {
    return degraded('portal/getSections', [], err)
  }
}

export async function getSectionBySlug(slug: string): Promise<SectionDoc | null> {
  try {
    return await withRetry(async () => {
      const payload = await getPayload({ config })
      const res = await payload.find({
        collection: 'sections',
        where: { slug: { equals: slug } },
        depth: 0,
        limit: 1,
      })
      return (res.docs[0] as SectionDoc | undefined) ?? null
    })
  } catch (err) {
    return degraded('portal/getSectionBySlug', null, err)
  }
}

// Активные баннеры зоны: включены вручную И период показа охватывает «сейчас»
// (пустая граница = не ограничено).
export async function getBanners(zone: 'header' | 'sidebar' | 'feed'): Promise<BannerDoc[]> {
  try {
    return await withRetry(async () => {
      const payload = await getPayload({ config })
      const now = new Date().toISOString()
      const res = await payload.find({
        collection: 'banners',
        where: {
          and: [
            { zone: { equals: zone } },
            { active: { equals: true } },
            { or: [{ startDate: { exists: false } }, { startDate: { less_than_equal: now } }] },
            { or: [{ endDate: { exists: false } }, { endDate: { greater_than_equal: now } }] },
          ],
        },
        depth: 1,
        limit: 10,
      })
      return res.docs as BannerDoc[]
    })
  } catch (err) {
    return degraded('portal/getBanners', [], err)
  }
}

export async function findPosts({
  sectionId,
  q,
  page = 1,
  limit = POSTS_PER_PAGE,
}: {
  sectionId?: number
  q?: string
  page?: number
  limit?: number
} = {}): Promise<{ docs: PostListItem[]; totalPages: number; totalDocs: number }> {
  try {
    return await withRetry(async () => {
      const payload = await getPayload({ config })
      const and: Where[] = [{ _status: { equals: 'published' } }]
      if (sectionId) and.push({ section: { equals: sectionId } })
      if (q) and.push({ or: [{ title: { like: q } }, { category: { like: q } }] })
      const res = await payload.find({
        collection: 'posts',
        where: { and },
        sort: '-date',
        depth: 1, // section + cover для карточек ленты
        page,
        limit,
      })
      return {
        docs: res.docs as PostListItem[],
        totalPages: res.totalPages,
        totalDocs: res.totalDocs,
      }
    })
  } catch (err) {
    return degraded('portal/findPosts', { docs: [], totalPages: 0, totalDocs: 0 }, err)
  }
}
