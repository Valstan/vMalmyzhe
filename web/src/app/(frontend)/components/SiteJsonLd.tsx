import React from 'react'

import { jsonLdHtml } from '../../../lib/jsonLd'
import { SITE_DESC, SITE_NAME, SITE_URL } from '../../../lib/site'

// Разметка издания и сайта — на каждой странице. Нужна, чтобы машина понимала
// не только «о чём эта страница», но и «что это за источник»: кто издаёт, о каком
// месте пишет, на каком языке. Для запросов вида «новости Малмыжа» связка
// издание↔место работает сильнее, чем текст статьи сам по себе.
const graph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'NewsMediaOrganization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESC,
      inLanguage: 'ru-RU',
      areaServed: {
        '@type': 'AdministrativeArea',
        name: 'Малмыжский район, Кировская область, Россия',
      },
      knowsLanguage: 'ru',
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESC,
      inLanguage: 'ru-RU',
      publisher: { '@id': `${SITE_URL}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ],
}

export function SiteJsonLd() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(graph) }}
    />
  )
}
