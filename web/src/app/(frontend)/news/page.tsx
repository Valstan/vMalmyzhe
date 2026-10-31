import type { Metadata } from 'next'

import { NewsView } from '../_views/NewsView'

// Лента новостей. Тело — _views/NewsView. ISR.
export const revalidate = 60

export const metadata: Metadata = {
  title: 'Новости',
  description:
    'Все новости Малмыжа и Малмыжского района одной лентой: события, культура, происшествия, объявления.',
  // Без своего canonical страница наследовала главную (баг найден 31.10).
  alternates: { canonical: '/news' },
}

export default function NewsPage() {
  return <NewsView />
}
