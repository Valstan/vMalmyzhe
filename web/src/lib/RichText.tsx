/* eslint-disable @next/next/no-img-element */
import React from 'react'

// Минимальный серверный рендер Lexical-richText → React. Поддерживает абзацы,
// заголовки (h2/h3), жирный/курсив/подчёркивание/зачёркивание, ссылки, списки,
// горизонтальную черту, переносы строк, картинки внутри текста (узел `upload`,
// mediaMap — id → url) и видео ВК (ссылка на vk.com/video… рендерится
// iframe-плеером vk.com/video_ext.php). Сложные узлы (block/relationship и
// т.п.) рендерятся как пустые — для новостного конвейера этого достаточно.

const FORMAT_BOLD = 1
const FORMAT_ITALIC = 2
const FORMAT_STRIKETHROUGH = 4
const FORMAT_UNDERLINE = 8

type LexNode = { type?: string; [k: string]: unknown }
type LexRoot = { root?: { children?: LexNode[] } }

// Встраиваемый плеер ВК: vk.com/video{oid}_{id} → video_ext.php (публичные
// видео проигрываются без hash). Если отдающий приложил player-URL
// (vk.com/video_ext.php?oid=…&id=…&hash=…) — используем как есть.
export function vkEmbedUrl(url: string): string | null {
  if (/^https?:\/\/vk\.com\/video_ext\.php/i.test(url)) return url
  const m = /vk\.com\/video(-?\d+)_(\d+)/i.exec(url)
  if (!m) return null
  return `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}`
}

function renderInline(children: unknown, keyPrefix: string): React.ReactNode[] {
  if (!Array.isArray(children)) return []
  return (children as LexNode[]).map((node, i) => {
    const key = `${keyPrefix}-${i}`
    const type = node?.type
    if (type === 'text') {
      let el: React.ReactNode = String(node.text ?? '')
      const fmt = typeof node.format === 'number' ? node.format : 0
      if (fmt & FORMAT_BOLD) el = <strong key={`${key}-b`}>{el}</strong>
      if (fmt & FORMAT_ITALIC) el = <em key={`${key}-i`}>{el}</em>
      if (fmt & FORMAT_UNDERLINE) el = <u key={`${key}-u`}>{el}</u>
      if (fmt & FORMAT_STRIKETHROUGH) el = <s key={`${key}-s`}>{el}</s>
      return <React.Fragment key={key}>{el}</React.Fragment>
    }
    if (type === 'linebreak') return <br key={key} />
    if (type === 'link' || type === 'autolink') {
      const fields = (node.fields as { url?: string; newTab?: boolean } | undefined) ?? {}
      const href = String(fields.url ?? '#')
      const embed = vkEmbedUrl(href)
      if (embed) {
        return (
          <iframe
            key={key}
            className="vk-video"
            src={embed}
            title={String(node.title ?? 'Видео ВКонтакте')}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
          />
        )
      }
      return (
        <a key={key} href={href} target={fields.newTab ? '_blank' : undefined} rel={fields.newTab ? 'noopener' : undefined}>
          {renderInline(node.children, key)}
        </a>
      )
    }
    return <React.Fragment key={key}>{renderInline(node.children, key)}</React.Fragment>
  })
}

// URL картинки из upload-узла richText. Payload 3: relationTo/value на уровне
// узла (version 3); version 2 держал их внутри fields. При population value —
// объект медиа (id/url), в сырой БД — id. Возвращает null, если это не media.
export function resolveUploadUrl(
  node: LexNode,
  mediaMap?: Record<string, string | undefined>,
): string | null {
  let rel: unknown = node.relationTo
  let value: unknown = node.value
  const legacyFields = (node.fields as
    | { relationTo?: string; value?: string | number | null }
    | undefined)
  if (rel == null && legacyFields?.relationTo === 'media') {
    rel = legacyFields.relationTo
    value = legacyFields.value
  }
  if (rel !== 'media' || value == null) return null
  if (typeof value === 'object') {
    const mediaObj = value as { id?: unknown; url?: string }
    return mediaMap?.[String(mediaObj.id)] ?? mediaObj.url ?? null
  }
  return mediaMap?.[String(value)] ?? null
}

export function RichText({
  data,
  mediaMap,
}: {
  data: unknown
  mediaMap?: Record<string, string | undefined>
}) {
  const root = (data as LexRoot)?.root
  if (!root || !Array.isArray(root.children)) return null
  return (
    <>
      {root.children.map((node, i) => {
        const key = `b-${i}`
        const type = node?.type
        if (type === 'heading') {
          const tag = node.tag === 'h3' ? 'h3' : 'h2'
          return React.createElement(tag, { key }, renderInline(node.children, key))
        }
        if (type === 'list') {
          const ordered = node.tag === 'ol' || node.listType === 'number'
          const items = Array.isArray(node.children) ? (node.children as LexNode[]) : []
          const lis = items.map((li, j) => (
            <li key={`${key}-${j}`}>{renderInline(li.children, `${key}-${j}`)}</li>
          ))
          return ordered ? <ol key={key}>{lis}</ol> : <ul key={key}>{lis}</ul>
        }
        if (type === 'horizontalrule') return <hr key={key} />
        if (type === 'paragraph') {
          const inner = renderInline(node.children, key)
          return <p key={key}>{inner}</p>
        }
        if (type === 'upload') {
          const url = resolveUploadUrl(node, mediaMap)
          if (!url) return null
          // Картинка внутри текста: клик открывает галерею поста (PostGallery).
          return (
            <img
              key={key}
              className="post-inline-img"
              src={url}
              alt=""
              loading="lazy"
              data-post-media
            />
          )
        }
        return null
      })}
    </>
  )
}
