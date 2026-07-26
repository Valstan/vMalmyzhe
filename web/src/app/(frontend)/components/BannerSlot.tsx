/* eslint-disable @next/next/no-img-element */
import React from 'react'

import { getBanners, type BannerDoc, type MediaDoc } from '../../../lib/portal'

// Баннерная зона (M1, концепт §5). Пустая зона не рендерит ничего.
// Ссылка ведёт через /api/banners/[id]/click — там инкремент счётчика и redirect.
// Обычный <img>, не next/image: картинка уже подготовлена в админке, а
// оптимизатор Next на баннерных размерах только добавляет латентность.

function Banner({ banner }: { banner: BannerDoc }) {
  const image = typeof banner.image === 'object' && banner.image ? (banner.image as MediaDoc) : null
  if (!image?.url || !banner.link) return null
  return (
    <a
      className="banner"
      href={`/api/banners/${banner.id}/click`}
      target="_blank"
      rel="noopener sponsored"
    >
      <img src={image.url} alt={image.alt || banner.title || 'Реклама'} loading="lazy" />
    </a>
  )
}

export async function BannerSlot({ zone }: { zone: 'header' | 'sidebar' | 'feed' }) {
  const banners = await getBanners(zone)
  if (banners.length === 0) return null
  return (
    <div className={`banner-slot banner-slot--${zone}`}>
      {banners.map((banner) => (
        <Banner key={banner.id} banner={banner} />
      ))}
    </div>
  )
}

// Для зоны «в ленте»: отдаёт баннеры списком, чтобы вызывающий код сам
// расставил их между постами.
export async function getFeedBanners(): Promise<React.ReactNode[]> {
  const banners = await getBanners('feed')
  return banners.map((banner) => <Banner key={`feed-${banner.id}`} banner={banner} />)
}
