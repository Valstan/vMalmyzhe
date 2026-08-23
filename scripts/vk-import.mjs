#!/usr/bin/env node
// Шаг 3 публикации: залить отобранные посты в портал через ingest.
//
//   node scripts/vk-import.mjs <отбор.json> [--dry] [--draft]
//
// Требует в окружении:
//   GATEWAY_KEY_VMALMYZHE — ключ доставки (авторизация в ingest)
//   INGEST_PUBLISH_KEY    — право публиковать; без него всё уедет черновиками
//
// Запускать ЛУЧШЕ НА ПРОД-БОКСЕ, где оба секрета уже лежат в
// prod-env — тогда они никуда не переносятся. См. docs/PUBLISHING.md (реквизиты
// бокса — в локальном неотслеживаемом docs/INFRA.local.md, репо публичный, D-038).
//
// Формат файла отбора — массив объектов:
//   { "id": 77618, "section": "afisha", "title": "…",
//     "keep": 1,            // сколько сюжетов поста оставить (счёт по «✍»)
//     "photos": [0,1],      // ИНДЕКСЫ вложений ЭТОГО поста, проверенные вручную
//     "videos": [0] }
//
// ⚠️ photos/videos перечисляются явно и никогда не «все подряд»: в сборных
// постах вложения принадлежат разным сюжетам, и «взять все» перемешает картинки
// между новостями. Проверка спорных — просмотром, docs/PUBLISHING.md §4.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OWNER_ID = -158787639
const ENDPOINT = process.env.INGEST_URL || 'http://127.0.0.1:3004/api/ingest/posts'

const DRY = process.argv.includes('--dry')
const FORCE_DRAFT = process.argv.includes('--draft')
const selectionPath = process.argv[2]
const wallPath = process.env.WALL_JSON || resolve(ROOT, 'scripts/.work/wall.json')

if (!selectionPath || selectionPath.startsWith('--')) {
  console.error('Укажите файл отбора: node scripts/vk-import.mjs отбор.json [--dry] [--draft]')
  process.exit(1)
}

const selection = JSON.parse(readFileSync(selectionPath, 'utf8'))
const wall = JSON.parse(readFileSync(wallPath, 'utf8')).response.items
const byId = new Map(wall.map((p) => [p.id, p]))

// Текст сюжета: ничего не переписываем, только снимаем обвязку агрегатора —
// его рубрику-заголовок, обратные ссылки [url|подпись] и хэштеги. Достоверность
// важнее гладкости: см. docs/PUBLISHING.md §5.
const extractText = (raw, keep) => {
  const parts = raw.split('✍').map((s) => s.trim())
  const segments = parts.length > 1 ? parts.slice(1) : [parts[0]]
  return segments
    .slice(0, keep ?? 1)
    .join('\n\n')
    .replace(/\[https?:\/\/[^\]|]+\|[^\]]*\]/g, '')
    .replace(/#[^\s#]+/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

const videoUrl = (v) =>
  `https://vk.com/video${v.owner_id}_${v.id}` + (v.access_key ? `?access_key=${v.access_key}` : '')

const pick = (list, indices, kind, id) =>
  (indices || []).map((i) => {
    if (!list[i]) throw new Error(`#${id}: ${kind} с индексом ${i} нет в посте`)
    return list[i]
  })

let ok = 0
let failed = 0

for (const item of selection) {
  const post = byId.get(item.id)
  if (!post) {
    console.error(`#${item.id}: нет в выгрузке — обновите wall.json`)
    failed++
    continue
  }

  const attachments = post.attachments || []
  const photos = attachments.filter((a) => a.type === 'photo')
  const videos = attachments.filter((a) => a.type === 'video')
  const iso = new Date(post.date * 1000).toISOString()

  let body
  try {
    body = {
      vkPostId: `${OWNER_ID}_${post.id}`,
      sourceUrl: `https://vk.com/wall${OWNER_ID}_${post.id}`,
      title: item.title,
      text: extractText(post.text || '', item.keep),
      section: item.section,
      // Дата новости и дата публикации = дата оригинала. Без publishedAt хук
      // populatePublishedAt проставит «сегодня», и старая новость станет свежей.
      date: iso,
      publishedAt: iso,
      publish: !FORCE_DRAFT,
      images: pick(photos, item.photos, 'фото', post.id).map((p) => ({
        url: p.photo.sizes.at(-1).url,
        alt: item.title,
      })),
      videos: pick(videos, item.videos, 'видео', post.id).map((v) => ({
        // player (video_ext.php с hash) есть не всегда; без него RichText
        // соберёт embed-URL сам из vk.com/video{oid}_{id}.
        url: v.video.player || videoUrl(v.video),
        title: v.video.title,
      })),
    }
  } catch (e) {
    console.error(`#${item.id}: ${e.message}`)
    failed++
    continue
  }

  if (DRY) {
    console.log(
      `#${post.id} → ${item.section} | ${iso.slice(0, 10)} | «${item.title}» | ` +
        `фото ${body.images.length}, видео ${body.videos.length}, текст ${body.text.length} симв.`,
    )
    continue
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Key': process.env.GATEWAY_KEY_VMALMYZHE || '',
      'X-Publish-Key': process.env.INGEST_PUBLISH_KEY || '',
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))

  if (res.ok) {
    ok++
    const warn = (json.warnings || []).length ? ` | ⚠ ${JSON.stringify(json.warnings)}` : ''
    console.log(`#${post.id} → ${item.section} | HTTP ${res.status} | id=${json.id} | published=${json.published}${warn}`)
  } else {
    failed++
    console.error(`#${post.id}: HTTP ${res.status} ${JSON.stringify(json)}`)
  }
}

console.log(`\nИтого: успешно ${ok}, ошибок ${failed}`)
if (failed) process.exitCode = 1
