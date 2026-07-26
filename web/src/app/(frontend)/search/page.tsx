import type { Metadata } from 'next'

import { findPosts } from '../../../lib/portal'
import { PostList } from '../components/PostList'

// Поиск по новостям (#035, M1-минимум): GET-форма, совпадение по заголовку и
// legacy-рубрике. Страница динамическая (searchParams), в кэш ISR не попадает.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Поиск',
  robots: { index: false },
}

type Args = { searchParams: Promise<{ q?: string }> }

export default async function SearchPage({ searchParams }: Args) {
  const { q } = await searchParams
  const query = (q ?? '').trim().slice(0, 100)
  const { docs, totalDocs } = query ? await findPosts({ q: query, limit: 50 }) : { docs: [], totalDocs: 0 }

  return (
    <section>
      <h1>Поиск</h1>
      <form className="search-form" action="/search" method="get">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Что ищем в новостях?"
          aria-label="Поисковый запрос"
          maxLength={100}
        />
        <button type="submit">Найти</button>
      </form>
      {query ? (
        <>
          <p className="muted">
            {totalDocs > 0 ? `Найдено: ${totalDocs}` : 'Ничего не нашлось. Попробуйте иначе.'}
          </p>
          <PostList posts={docs} heading="h2" />
        </>
      ) : null}
    </section>
  )
}
