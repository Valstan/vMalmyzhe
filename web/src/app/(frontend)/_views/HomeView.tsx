import Link from 'next/link'
import config from '@payload-config'
import { getPayload } from 'payload'

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

      <section className="home-hero">
        <div className="home-hero__copy">
          <span className="eyebrow">Главное место района</span>
          <h1>{home?.title || 'Живём в Малмыже'}</h1>
          <p>{home?.subtitle || 'Новости, люди, события и полезные дела — всё, чем живёт наш город и район.'}</p>
          {home?.intro ? <p className="home-hero__intro">{home.intro}</p> : null}
          <div className="home-hero__actions">
            <Link className="button" href="/news">Читать новости</Link>
            <Link className="button button--secondary" href="/news/section/afisha">Смотреть афишу</Link>
          </div>
        </div>
        <div className="today-card">
          <span className="eyebrow">Сегодня в Малмыже</span>
          <strong>Будьте в курсе событий рядом с домом</strong>
          <p>Афиша, важные сообщения и свежие публикации района.</p>
          <Link href="/news/section/afisha">Что происходит сегодня →</Link>
        </div>
      </section>

      <div className="home-columns">
        <section className="home-feed">
          <div className="section-heading">
            <div><span className="eyebrow">Картина дня</span><h2>Свежие новости</h2></div>
            <Link href="/news">Все новости →</Link>
          </div>
          <SectionChips sections={sections} />
          {posts.length ? <PostList posts={posts} feedExtras={feedBanners} /> : (
            <div className="empty-news">
              <div className="empty-news__icon">▤</div>
              <h3>Редакция готовит первые новости</h3>
              <p>Скоро здесь появится всё важное из жизни города и района.</p>
              <Link className="button button--secondary" href="/news">Открыть ленту</Link>
            </div>
          )}
        </section>

        <aside className="home-aside">
          <section className="aside-card">
            <span className="eyebrow">На этой неделе</span>
            <h2>Афиша района</h2>
            <div className="event-row"><b>Сб</b><span><strong>Семейный выходной</strong><small>События для всей семьи</small></span></div>
            <div className="event-row"><b>Вс</b><span><strong>Культура и спорт</strong><small>Выбирайте, куда сходить</small></span></div>
            <Link className="button" href="/news/section/afisha">Вся афиша</Link>
          </section>
          <BannerSlot zone="sidebar" />
        </aside>
      </div>

      <section className="portal-section">
        <div className="section-heading"><div><span className="eyebrow">Всегда под рукой</span><h2>Полезно жителям</h2></div></div>
        <div className="service-grid">
          <Link href="/search?q=транспорт"><span>▣</span>Транспорт</Link>
          <Link href="/news/section/zhkh"><span>⌂</span>ЖКХ и благоустройство</Link>
          <Link href="/search?q=медицина"><span>✚</span>Медицина</Link>
          <Link href="/search?q=службы"><span>☎</span>Важные службы</Link>
        </div>
      </section>

      <section className="portal-section business-section">
        <div className="section-heading"><div><span className="eyebrow">Покупаем у своих</span><h2>Местный бизнес</h2></div><Link href="/pages/reklama">Разместить рекламу →</Link></div>
        <div className="business-grid">
          <article><span className="ad-label">Реклама</span><h3>Предприятия Малмыжа</h3><p>Товары и услуги рядом с домом.</p></article>
          <article><span className="ad-label">Каталог</span><h3>Мастера и ИП района</h3><p>Найдите нужного специалиста.</p></article>
          <article><span className="ad-label">Для бизнеса</span><h3>Расскажите о себе</h3><p>Станьте заметнее для земляков.</p></article>
        </div>
      </section>

      {home?.contacts ? (
        <section className="portal-section">
          <h2>Контакты</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{home.contacts}</p>
        </section>
      ) : null}
    </>
  )
}
