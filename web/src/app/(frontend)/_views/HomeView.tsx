import Link from 'next/link'
import config from '@payload-config'
import { getPayload } from 'payload'

import { SITE_NAME } from '../../../lib/site'
import { withRetry } from '../../../lib/withRetry'
import { findPosts, getSections } from '../../../lib/portal'
import { BannerSlot, getFeedBanners } from '../components/BannerSlot'
import { PostList, SectionChips } from '../components/PostList'

type Home = {
  title?: string | null
  subtitle?: string | null
  intro?: string | null
  contacts?: string | null
}

async function getHome(): Promise<Home | null> {
  try {
    return await withRetry(async () => {
      const payload = await getPayload({ config })
      return (await payload.findGlobal({ slug: 'home', depth: 0 })) as Home
    })
  } catch {
    return null
  }
}

// Главная портала (M1): шапочный баннер, лента свежего с баннерами «в ленте»,
// рубрики, сайдбарный баннер. Тексты главной — глобал home.
export async function HomeView() {
  const [home, sections, feedBanners, { docs: posts }] = await Promise.all([
    getHome(),
    getSections(),
    getFeedBanners(),
    findPosts({ limit: 10 }),
  ])

  return (
    <>
      <BannerSlot zone="header" />

      <section>
        <h1>{home?.title || SITE_NAME}</h1>
        {home?.subtitle ? <p className="muted">{home.subtitle}</p> : null}
        {home?.intro ? <p>{home.intro}</p> : null}
      </section>

      <div className="home-columns">
        <section className="home-feed">
          <h2>Новости</h2>
          <SectionChips sections={sections} />
          <PostList posts={posts} feedExtras={feedBanners} />
          <p>
            <Link href="/news">Все новости →</Link>
          </p>
        </section>

        <aside className="home-aside">
          <BannerSlot zone="sidebar" />
        </aside>
      </div>

      {home?.contacts ? (
        <section>
          <h2>Контакты</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{home.contacts}</p>
        </section>
      ) : null}
    </>
  )
}
