'use client'

/* eslint-disable @next/next/no-img-element */
// Галерея поста с пролистыванием (заказ владельца 05.08). Клиентский компонент:
// собирает все медиа поста — картинки в тексте (data-post-media), галерею и
// обложку — и открывает их по клику в лайтбоксе с кнопками «назад/вперёд» и
// клавиатурой (Esc — закрыть, ←/→ — листать). Новых зависимостей нет.
// Контейнер находится сам: компонент рендерится внутри <article> поста и
// ищет ближайшего предка-article по DOM.

import { useEffect, useRef, useState } from 'react'

type MediaItem = { src: string; alt: string }

export function PostGallery() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [items, setItems] = useState<MediaItem[]>([])
  const [index, setIndex] = useState<number | null>(null)
  const itemsRef = useRef<MediaItem[]>([])
  itemsRef.current = items

  useEffect(() => {
    const root = rootRef.current?.closest('article')
    if (!root) return

    const collect = () =>
      Array.from(root.querySelectorAll<HTMLImageElement>('img[data-post-media]')).map((img) => ({
        src: img.currentSrc || img.src,
        alt: img.alt || '',
      }))
    setItems(collect())

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const img = target.closest('img[data-post-media]') as HTMLImageElement | null
      if (!img) return
      const imgs = Array.from(
        root.querySelectorAll<HTMLImageElement>('img[data-post-media]'),
      )
      const i = imgs.indexOf(img)
      if (i >= 0) setIndex(i)
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIndex(null)
      if (e.key === 'ArrowRight')
        setIndex((i) => (i === null ? i : (i + 1) % itemsRef.current.length))
      if (e.key === 'ArrowLeft')
        setIndex((i) =>
          i === null ? i : (i - 1 + itemsRef.current.length) % itemsRef.current.length,
        )
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [index])

  if (index === null) return <div ref={rootRef} className="post-gallery-root" />
  const item = items[index]
  const total = items.length

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Галерея" onClick={() => setIndex(null)}>
      <button
        type="button"
        className="lightbox__close"
        aria-label="Закрыть галерею"
        onClick={(e) => {
          e.stopPropagation()
          setIndex(null)
        }}
      >
        ✕
      </button>
      {total > 1 ? (
        <>
          <button
            type="button"
            className="lightbox__nav lightbox__prev"
            aria-label="Предыдущее фото"
            onClick={(e) => {
              e.stopPropagation()
              setIndex((index - 1 + total) % total)
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="lightbox__nav lightbox__next"
            aria-label="Следующее фото"
            onClick={(e) => {
              e.stopPropagation()
              setIndex((index + 1) % total)
            }}
          >
            ›
          </button>
        </>
      ) : null}
      <figure className="lightbox__stage" onClick={(e) => e.stopPropagation()}>
        <img src={item.src} alt={item.alt} />
        <figcaption>
          {index + 1} / {total}
          {item.alt ? ` — ${item.alt}` : ''}
        </figcaption>
      </figure>
    </div>
  )
}
