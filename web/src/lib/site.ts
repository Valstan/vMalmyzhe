// Единый источник правды о сайте — URL, название, описание. Используется в
// метаданных, robots, sitemap. Боевой URL бейкается из env при сборке; фолбэк —
// punycode-домен вмалмыже.рф (кириллица в CI-bash бьётся — поэтому ASCII-форма).
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SERVER_URL || 'https://xn--80adkdyec4j.xn--p1ai'
).replace(/\/$/, '')

export const SITE_NAME = 'вМалмыже.РФ'

export const SITE_DESC = 'вМалмыже.РФ — сайт о Малмыже. Новости и материалы.'
