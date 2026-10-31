import { NextResponse, type NextRequest } from 'next/server'

// Легаси-адреса Вордпресса на главной: /?p=2996, /?m=202507, /?paged=2 и т.п.
// Сайт после переезда отдавал по ним копию главной с кодом 200, и Яндекс держал
// их в индексе как «Неканонические», а Диагностика ругалась на пустые description
// (найдено в Вебмастере 31.10). Соответствий «старый ID → новая новость» нет,
// поэтому 301 на главную: страница живёт, но дубля в индексе не остаётся.
const LEGACY_PARAMS = ['p', 'm', 'paged', 'attachment_id', 'replytocom', 's']

export function middleware(request: NextRequest) {
  const hasLegacy = LEGACY_PARAMS.some((key) => request.nextUrl.searchParams.has(key))
  if (!hasLegacy) return NextResponse.next()

  const url = request.nextUrl.clone()
  // Сбрасываем строку целиком: utm-метки на главной не трогаем, а легаси-ключи
  // в адресе назначения оставлять нельзя — получился бы тот же дубль.
  url.search = ''
  return NextResponse.redirect(url, 301)
}

// Только главная: /news?p=… и прочие маршруты с этими ключами не существуют.
export const config = { matcher: '/' }
