import path from 'path'
import { fileURLToPath } from 'url'

import { withPayload } from '@payloadcms/next/withPayload'

import { buildSecurityHeaders } from './src/lib/securityHeaders.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const NEXT_PUBLIC_SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL || process.env.__NEXT_PRIVATE_ORIGIN || 'http://localhost:3004'

// .js, а не .ts: Next 16 не грузит next.config.ts с импортами (компилятор
// отдаёт CJS `exports` в ESM-скоуп — проверено бисекцией 29.09). Single-source
// с рантаймом сохранён: origin ЕСА и сборка заголовков живут в
// `src/lib/securityHeaders.mjs`, который импортируют и конфиг, и TS-код (G311).
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Позволяет агентам и локальным проверкам запускать изолированную сборку,
  // не мешая уже работающему dev-серверу соседнего проекта.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Прод-VPS (мало RAM) не тянет `next build` (OOM). Сборка едет в CI
  // (GitHub Actions, ubuntu), на сервер кладём готовый standalone-сервер.
  // tracingRoot = web/ — чтобы server.js лёг в корень .next/standalone.
  //
  // ⚠️ standalone-сборка делает outputFileTracing, который МУТИРУЕТ локальный
  // node_modules. Поэтому standalone включаем ТОЛЬКО по флагу STANDALONE_BUILD=1
  // (его ставит deploy-prod.yml). Локальный `next build` — обычный, node_modules
  // не портит → можно собирать повторно без реинстолла.
  output: process.env.STANDALONE_BUILD === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: __dirname,
  images: {
    remotePatterns: [
      ...[NEXT_PUBLIC_SERVER_URL].map((item) => {
        const url = new URL(item)
        return {
          hostname: url.hostname,
          protocol: url.protocol.replace(':', ''),
        }
      }),
    ],
  },
  reactStrictMode: true,
  // «X-Powered-By: Next.js, Payload» наружу не нужен: версия стека — подсказка
  // сканеру, а он и так стучит (журнал 12.09).
  poweredByHeader: false,
  // Заголовки безопасности — на все маршруты, включая /admin и /api.
  // Значение фиксируется на сборке: см. lib/securityHeaders.mjs.
  headers: async () => [{ source: '/(.*)', headers: buildSecurityHeaders() }],
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
