import { postgresAdapter } from '@payloadcms/db-postgres'
import type { NodemailerAdapterArgs } from '@payloadcms/email-nodemailer'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import sharp from 'sharp'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { Banners } from './collections/Banners'
import { Pages } from './collections/Pages'
import { Posts } from './collections/Posts'
import { Media } from './collections/Media'
import { Sections } from './collections/Sections'
import { Users } from './collections/Users'
import { HomeContent } from './globals/HomeContent'
import { SiteHeader } from './globals/SiteHeader'
import { SiteFooter } from './globals/SiteFooter'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Тип опций транспорта — от Payload-адаптера, с добавлением `auth`.
// `nodemailerAdapter` объявляет `transportOptions` как `SMTPConnection.Options`,
// но в nodemailer 10 (единственная ветка без CVE в addressparser) `auth`
// переехал из `SMTPConnectionOptions` в `SMTPTransportOptions`. Адаптер передаёт
// объект прямо в `createTransport`, чья подпись — `SMTPTransportOptions`, то есть
// `auth` законен и на рантайме, и по типам самого nodemailer. Аннотация Payload
// (3.90.1) устарела; правим её локальным cast, а не откатом на уязвимую ветку.
// Откат невозможен: патча в ветке 9 нет (последняя — 9.1.1, advisory покрывает
// <=10.0.5). Сам `nodemailer` импортировать нельзя — он не прямой зависимость,
// а deep-пути (`nodemailer/lib/*`) закрыты `exports`-картой без условия `types`.
type SmtpTransportOptions = NonNullable<NodemailerAdapterArgs['transportOptions']> & {
  auth?: { user?: string; pass?: string }
}

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: ' — вМалмыже.РФ',
    },
  },
  editor: lexicalEditor(),
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || '',
    },
    // MVP/greenfield: push автосинхронизирует схему в dev. Прод-миграции —
    // на этапе деплоя (web/src/migrations/).
    push: true,
  }),
  // G339: cookiePrefix с префиксом __Host- для защиты от подброса cookie
  // соседями поддоменов. Браузер требует Secure + Path=/ + без Domain.
  cookiePrefix: '__Host-payload',
  collections: [Pages, Posts, Sections, Banners, Media, Users],
  globals: [HomeContent, SiteHeader, SiteFooter],
  // Email-уведомления (опционально). Провайдеро-независимо: любой внешний SMTP-relay
  // задаётся через env. Пока SMTP_HOST не задан, адаптер не подключаем → Payload
  // пишет письма в консоль (dev/CI) — сборка и типы остаются зелёными без секретов.
  // Реальные SMTP-доступы живут ТОЛЬКО в prod-env бокса (вне репо, pool #008).
  email: process.env.SMTP_HOST
    ? nodemailerAdapter({
        defaultFromAddress: process.env.SMTP_FROM_ADDRESS || 'no-reply@xn--80adkdyec4j.xn--p1ai',
        defaultFromName: process.env.SMTP_FROM_NAME || 'вМалмыже.РФ',
        transportOptions: {
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          // 465 = implicit TLS (secure); 587/2525 = STARTTLS (secure:false).
          secure: process.env.SMTP_SECURE
            ? process.env.SMTP_SECURE === 'true'
            : Number(process.env.SMTP_PORT) === 465,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        } as SmtpTransportOptions,
      })
    : undefined,
  cors: [process.env.NEXT_PUBLIC_SERVER_URL || ''].filter(Boolean),
  secret: process.env.PAYLOAD_SECRET || '',
  sharp,
  i18n: {
    fallbackLanguage: 'ru',
  },
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
