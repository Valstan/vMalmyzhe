// Статистика Яндекс.Метрики для информера в подвале.
//
// Штатный картиночный информер Яндекса показывает только сегодняшние цифры, а
// нужны «сегодня и вчера» — поэтому ходим в Reporting API сами, на сервере.
// Токен наружу не попадает: запрос делает серверный компонент, в браузер уезжают
// только готовые числа.
//
// Нужны две переменные окружения; нет хотя бы одной — информер просто не
// рендерится (сайт при этом полностью рабочий):
//   NEXT_PUBLIC_YANDEX_METRIKA_ID — номер счётчика (он же нужен для JS-счётчика)
//   YANDEX_METRIKA_TOKEN          — OAuth-токен с доступом на чтение статистики

const API = 'https://api-metrika.yandex.net/stat/v1/data'

type DayStats = { users: number; pageviews: number }
export type MetrikaStats = { today: DayStats; yesterday: DayStats } | null

// Номер счётчика подставляется внутрь инлайнового `<script>` (YandexMetrika.tsx)
// — та же поверхность, что JSON-LD в G209, только источник не пользовательский,
// а прод-env. Пропускаем одни цифры: класс закрыт по конструкции, а заодно
// опечатка в переменной окружения не даёт молча битый счётчик — информер и
// счётчик просто не рендерятся, как и при пустом значении.
export function normalizeMetrikaId(raw: string | undefined): string {
  const value = (raw || '').trim()
  return /^\d+$/.test(value) ? value : ''
}

export const METRIKA_ID = normalizeMetrikaId(process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID)

const empty: DayStats = { users: 0, pageviews: 0 }

export async function getMetrikaStats(): Promise<MetrikaStats> {
  const token = process.env.YANDEX_METRIKA_TOKEN
  if (!METRIKA_ID || !token) return null

  const url =
    `${API}?ids=${encodeURIComponent(METRIKA_ID)}` +
    '&metrics=ym:s:users,ym:s:pageviews' +
    '&dimensions=ym:s:date&date1=yesterday&date2=today&group=day&limit=10'

  try {
    const res = await fetch(url, {
      headers: { Authorization: `OAuth ${token}` },
      // Кеш на 10 минут: цифры в подвале не обязаны быть посекундными, а
      // дёргать API на каждый запрос страницы незачем.
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null

    const json = (await res.json()) as {
      data?: { dimensions: { name?: string }[]; metrics: number[] }[]
    }
    const rows = json.data ?? []
    if (!rows.length) return null

    // Метрика отдаёт строки по датам; сортируем по дате и берём последнюю как
    // «сегодня», предыдущую как «вчера» — так порядок не зависит от API.
    const parsed = rows
      .map((r) => ({
        date: r.dimensions?.[0]?.name ?? '',
        users: Math.round(r.metrics?.[0] ?? 0),
        pageviews: Math.round(r.metrics?.[1] ?? 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const today = parsed.at(-1)
    const yesterday = parsed.length > 1 ? parsed.at(-2) : undefined

    return {
      today: today ? { users: today.users, pageviews: today.pageviews } : empty,
      yesterday: yesterday ? { users: yesterday.users, pageviews: yesterday.pageviews } : empty,
    }
  } catch {
    // Метрика недоступна — подвал просто без информера, страница цела.
    return null
  }
}

