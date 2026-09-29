import React from 'react'

import { jsonLdHtml } from '../../../lib/jsonLd'
import { FAQ_ITEMS, faqJsonLd } from '../../../lib/faq'

// FAQ-блок главной (п.6 чек-листа D-088, тексты утверждены владельцем 29.09).
// Раскрытие — нативный details/summary: работает без JS, доступно из коробки.
export function FaqSection() {
  return (
    <section className="portal-section faq-section" aria-labelledby="faq-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Спрашивали? Отвечаем</span>
          <h2 id="faq-heading">Частые вопросы</h2>
        </div>
      </div>
      {FAQ_ITEMS.map((item) => (
        <details key={item.q} className="faq-item">
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(faqJsonLd()) }} />
    </section>
  )
}
