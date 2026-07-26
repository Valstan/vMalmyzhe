import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

import { safeRevalidatePath } from '../lib/safeRevalidate'

// On-demand ISR для справочников портала (рубрики, баннеры): их правка меняет
// главную и всё поддерево /news (чипы рубрик, баннерные зоны, метки в карточках).
const revalidatePortalPaths = (payload: { logger: { info: (m: string) => void } }) => {
  payload.logger.info('[revalidate] sections/banners → /, /news (layout)')
  safeRevalidatePath('/', 'page')
  safeRevalidatePath('/news', 'layout')
}

export const revalidatePortal: CollectionAfterChangeHook = ({ doc, req: { payload, context } }) => {
  if (!context.disableRevalidate) revalidatePortalPaths(payload)
  return doc
}

export const revalidatePortalDelete: CollectionAfterDeleteHook = ({
  doc,
  req: { payload, context },
}) => {
  if (!context.disableRevalidate) revalidatePortalPaths(payload)
  return doc
}
