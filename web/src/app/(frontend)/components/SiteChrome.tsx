import Link from 'next/link'
import React from 'react'

import type { MetrikaStats } from '../../../lib/metrika'
import { AUTHOR_CREDIT, AUTHOR_URL, SERVICES_CATALOG_URL, SITE_NAME } from '../../../lib/site'
import { YandexMetrika } from './YandexMetrika'

// «5 посетителей» / «1 посетитель» / «22 посетителя» — без этого счётчик в
// подвале читается как машинный вывод.
const plural = (n: number, one: string, few: string, many: string) => {
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

const describe = (label: string, day: { users: number; pageviews: number }) =>
  `${label}: ${day.users} ${plural(day.users, 'посетитель', 'посетителя', 'посетителей')}, ` +
  `${day.pageviews} ${plural(day.pageviews, 'просмотр', 'просмотра', 'просмотров')}`

export type NavItem = { label: string; href: string }
export type ChromeContent = {
  brand: string | null
  nav: NavItem[]
  copyright: string | null
  contacts: string | null
} | null

// Шапка + подвал сайта. Тексты приходят из глобалов header/footer (могут быть
// пустыми в свежем каркасе) — тогда падаем на код-фолбэк.
export function SiteChrome({
  chrome,
  stats,
  children,
}: {
  chrome: ChromeContent
  stats?: MetrikaStats
  children: React.ReactNode
}) {
  const brand = chrome?.brand || SITE_NAME
  const nav = chrome?.nav?.length
    ? chrome.nav
    : [
        { label: 'Новости', href: '/news' },
        { label: 'Афиша', href: '/news/section/afisha' },
        { label: 'Объявления', href: '/news/section/obyavleniya' },
        { label: 'Культура и спорт', href: '/news/section/kultura-sport' },
        { label: 'История Малмыжа', href: '/news/section/istoriya-malmyzha' },
        { label: 'Поиск', href: '/search' },
      ]
  const copyright = chrome?.copyright || `© ${new Date().getFullYear()} ${SITE_NAME}`

  return (
    <div className="site">
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <span>Малмыж и Малмыжский район</span>
          <span className="utility-bar__message">Всё важное — рядом</span>
          <a href="tel:112">Экстренные службы: 112</a>
        </div>
      </div>
      <header className="site-header">
        <div className="container site-header__inner">
          <Link href="/" className="site-brand">
            <span className="site-brand__name">{brand}</span>
            <span className="site-brand__tagline">Город, район, наши люди</span>
          </Link>
          <form className="header-search" action="/search" role="search">
            <input name="q" type="search" aria-label="Поиск по сайту" placeholder="Найти новость, событие, организацию" />
            <button type="submit" aria-label="Искать">⌕</button>
          </form>
          {/* Кнопка в каталог сервисов экосистемы — п.3 стандарта онбординга
              (внешний домен, поэтому обычный <a>, а не next/link). */}
          <a className="services-cta" href={SERVICES_CATALOG_URL}>
            <span className="services-cta__icon" aria-hidden="true">
              ✦
            </span>
            <span className="services-cta__text">
              <strong>Сервисы вМалмыже.рф</strong>
              <small>Все городские сервисы — в одном каталоге</small>
            </span>
            <span className="services-cta__arrow" aria-hidden="true">
              →
            </span>
          </a>
          <nav className="site-nav" aria-label="Основная навигация">
            {nav.map((item, i) => (
              <Link key={`${item.href}-${i}`} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="site-main container">{children}</main>

      <footer className="site-footer">
        <div className="container site-footer__grid">
          <div>
            <div className="site-footer__brand">{brand}</div>
            <p>Местный портал для жителей Малмыжа и Малмыжского района.</p>
          </div>
          <div>
            <strong>Разделы</strong>
            <Link href="/news">Новости</Link>
            <Link href="/news/section/afisha">Афиша</Link>
            <Link href="/news/section/obyavleniya">Объявления</Link>
          </div>
          <div>
            <strong>Портал</strong>
            <Link href="/search">Поиск</Link>
            <Link href="/pages/o-proekte">О проекте</Link>
            <Link href="/pages/reklama">Разместить рекламу</Link>
          </div>
          <div>
            <strong>Связаться</strong>
            {chrome?.contacts ? <p className="site-footer__contacts">{chrome.contacts}</p> : <p>Предложить новость или событие</p>}
          </div>
        </div>
        {stats ? (
          <div className="container site-footer__stats">
            <span className="site-footer__stats-label">Посещаемость</span>
            <span>{describe('Сегодня', stats.today)}</span>
            <span>{describe('Вчера', stats.yesterday)}</span>
          </div>
        ) : null}
        <div className="container site-footer__bottom">
          <p className="site-footer__copyright">{copyright}</p>
          {/* Подпись автора — п.4 стандарта онбординга (mandate 2026-08-01). */}
          <span className="site-footer__author">
            Сделано с заботой о нашем районе. (с){' '}
            <a href={AUTHOR_URL} rel="author noopener" target="_blank">
              {AUTHOR_CREDIT}
            </a>
            , {new Date().getFullYear()}
          </span>
        </div>
      </footer>
      <YandexMetrika />
    </div>
  )
}
