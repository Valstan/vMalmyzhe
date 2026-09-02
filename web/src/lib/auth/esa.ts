// ── ЕСА вМалмыже.рф (OIDC-провайдер «Радар» в Сарафане/setka) — конфиг клиента ──
//
// Контракт: brain_matrica/docs/plans/unified-auth-concept.md §4 — Authorization
// Code + PKCE (S256) + state + nonce; id_token RS256 по jwks_uri; claims
// sub / email / email_verified / name. Роли ЕСА не диктует — портал решает сам.
// Рецепт — клиент Интера (trener/web/src/lib/auth/oidc.ts, read-only, ADR-0007).
//
// Этот файл — только конфиг и redirect_uri: строка, которую код отдаёт байт в
// байт, сверяется Сарафаном тремя посимвольными сравнениями без нормализации
// (письмо brain 25.08). Сам поток (start/callback/сессия) — следующим PR.

export type EsaConfig = {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
}

// Issuer ЕСА — вход.вмалмыже.рф. В коде только punycode (G133): кириллический
// хост в сравнении молча не совпадёт, а в CI-bash ещё и бьётся.
export const ESA_ISSUER_DEFAULT = 'https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai'

// Открытый идентификатор клиента, выданный Сарафаном 25.08.
export const ESA_CLIENT_ID_DEFAULT = 'portal'

// Путь колбэка. Зарегистрирован у Сарафана в punycode-форме хоста.
export const ESA_CALLBACK_PATH = '/api/auth/callback'

// WHATWG URL Node каноникализирует хост в punycode и приводит регистр, так что
// «https://вмалмыже.рф» и «https://xn--80adkdyec4j.xn--p1ai» дают одну строку.
// Хвостовой слэш снимаем только у корня (`new URL('https://h').href` → `https://h/`),
// у пути его не трогаем: redirect_uri сравнивается без нормализации.
export const normalizeUrl = (raw: string): string | null => {
  try {
    const u = new URL(raw)
    if (u.search || u.hash) return null
    return u.pathname === '/' ? u.origin : u.origin + u.pathname
  } catch {
    return null
  }
}

// redirect_uri, который портал отдаёт в authorize и token. Чистая функция —
// тест фиксирует точную строку, та же строка уходит Сарафану письмом.
export const buildRedirectUri = (serverUrl: string): string | null =>
  normalizeUrl(serverUrl.replace(/\/$/, '') + ESA_CALLBACK_PATH)

// ЕСА сконфигурирован = есть секрет. Иначе null: кнопка не рендерится, маршруты
// /api/auth/* отвечают 404, портал живёт без входа (graceful-degrade, MUST
// контракта). Читаем env на каждый вызов: прод — runtime standalone, не build-time.
// Имя секрета в prod-env — ESA_CLIENT_SECRET_PORTAL (так он выдан в комнату
// КАРМАНа; prod-env — источник истины, комната держит зеркало, #171).
export const getEsaConfig = (): EsaConfig | null => {
  const clientSecret = process.env.ESA_CLIENT_SECRET_PORTAL
  if (!clientSecret) return null

  const issuer = normalizeUrl(process.env.ESA_ISSUER_URL || ESA_ISSUER_DEFAULT)
  const redirectUri = process.env.ESA_REDIRECT_URI
    ? normalizeUrl(process.env.ESA_REDIRECT_URI)
    : buildRedirectUri(process.env.NEXT_PUBLIC_SERVER_URL || '')
  if (!issuer || !redirectUri) return null

  return {
    issuer,
    clientId: process.env.ESA_CLIENT_ID || ESA_CLIENT_ID_DEFAULT,
    clientSecret,
    redirectUri,
  }
}
