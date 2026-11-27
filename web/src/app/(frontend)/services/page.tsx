import type { Metadata } from 'next'

import { esaServices } from '../../../lib/auth/esaInternal'

// Каталог сервисов экосистемы Малмыжа — на портале.
//
// Источник один: список живёт в сервисе ЕСА (он же владелец каталога), портал
// забирает его по внутреннему API. Дубль списка в коде портала — это два
// места, которые со временем разойдутся (правило #087: правка в одной копии
// — это не правка, а расхождение).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Сервисы Малмыжа',
  description:
    'Все городские сервисы Малмыжа и Малмыжского района в одном каталоге: новости и афиша портала, справчник услуг, праздники, школа, такси, культура.',
  alternates: { canonical: '/services' },
}

export default async function ServicesPage() {
  const result = await esaServices()
  const services = result.ok ? result.value : []

  return (
    <section className="services-page">
      <p className="eyebrow">Каталог</p>
      <h1>Сервисы Малмыжа</h1>
      <p className="muted">
        Все городские сервисы — на одной странице. Вход общий: вошли на портале — вошли
        везде.
      </p>

      {services.length > 0 ? (
        <div className="services-grid">
          {services.map((s) => (
            <a key={s.title} className="services-card" href={s.url} rel="noopener noreferrer">
              <span className="services-card__icon" aria-hidden="true">
                {s.emoji}
              </span>
              <span className="services-card__body">
                <span className="services-card__title">{s.title}</span>
                <span className="services-card__desc">{s.desc}</span>
              </span>
              <span className="services-card__arrow" aria-hidden="true">
                →
              </span>
            </a>
          ))}
        </div>
      ) : (
        <p className="muted">
          Каталог сервисов сейчас недоступен. Список также открыт по адресу{' '}
          <a href="https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai/services">вход.вмалмыже.рф</a>.
        </p>
      )}
    </section>
  )
}
