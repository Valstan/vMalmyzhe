// Единый источник правды о сайте — URL, название, описание. Используется в
// метаданных, robots, sitemap. Боевой URL бейкается из env при сборке; фолбэк —
// punycode-домен вмалмыже.рф (кириллица в CI-bash бьётся — поэтому ASCII-форма).
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SERVER_URL || 'https://xn--80adkdyec4j.xn--p1ai'
).replace(/\/$/, '')

export const SITE_NAME = 'вМалмыже.РФ'

export const SITE_DESC =
  'вМалмыже.РФ — городской портал Малмыжа и Малмыжского района: новости, события, объявления и полезная информация.'

// Каталог сервисов экосистемы (ведёт setka/SARAFAN). Кнопка на него в шапке —
// п.3 стандарта онбординга brain_matrica (docs/SERVICE_ONBOARDING.md, mandate
// владельца 2026-07-26; триггер для портала — «при наполнении контентом»).
// Адрес в punycode намеренно: кириллический URL бьётся в части клиентов и в CI,
// живой домен — вход.вмалмыже.рф/services.
export const SERVICES_CATALOG_URL = 'https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai/services'

// Подпись автора в подвале — п.4 стандарта онбординга (mandate владельца
// 2026-08-01). Формулировка адаптируема, смысл и ссылка обязательны.
// Живой домен — валентин.вмалмыже.рф (прод с 02.08).
export const AUTHOR_URL = 'https://xn--80adkmnnb2b.xn--80adkdyec4j.xn--p1ai/'
export const AUTHOR_NAME = 'Валентином Савиных'
