import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import config from '../../../../../payload.config'

// Клик по баннеру: инкремент счётчика + redirect на целевую ссылку
// (news-portal-concept §5 — счётчик сразу, аналитика показов позже).
// Витрина M1 ставит href баннера на /api/banners/<id>/click.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const payload = await getPayload({ config })
  let banner
  try {
    banner = await payload.findByID({ collection: 'banners', id: numericId })
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // Счётчик — best-effort: сбой инкремента не должен ломать переход.
  try {
    await payload.update({
      collection: 'banners',
      id: numericId,
      data: { clicks: (banner.clicks ?? 0) + 1 },
    })
  } catch (error) {
    payload.logger.warn(`banner ${numericId} click counter failed: ${String(error)}`)
  }

  // Открытый redirect наружу не даём: ведём только на ссылку из самого баннера.
  return NextResponse.redirect(banner.link, 302)
}
