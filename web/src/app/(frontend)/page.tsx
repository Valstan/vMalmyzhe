import type { Metadata } from 'next'

import { RSS_ALTERNATES } from '../../lib/site'
import { HomeView } from './_views/HomeView'

// Главная. Тело — _views/HomeView (тексты главной + последние новости). ISR.
export const revalidate = 60

// Канонический адрес главной — здесь, а не в layout (см. комментарий там).
// types — потому что этот объект перекрывает layout-овский `alternates` целиком.
export const metadata: Metadata = {
  alternates: { canonical: '/', types: RSS_ALTERNATES },
}

export default function HomePage() {
  return <HomeView />
}
