import type { CollectionConfig } from 'payload'

import { adminOrEditor } from '../access/adminOrEditor'
import { anyone } from '../access/anyone'
import { revalidatePortal, revalidatePortalDelete } from '../hooks/revalidatePortal'

// Рекламные баннеры (M0 news-portal-concept §5). Прямые размещения без внешних
// ad-сетей: зона показа, период, картинка, ссылка. Клики считает redirect-роут
// /api/banners/[id]/click (инкремент clicks), витрина зон — этап M1.
export const Banners: CollectionConfig = {
  slug: 'banners',
  labels: {
    singular: 'Баннер',
    plural: 'Баннеры',
  },
  access: {
    create: adminOrEditor,
    delete: adminOrEditor,
    read: anyone,
    update: adminOrEditor,
  },
  admin: {
    defaultColumns: ['title', 'zone', 'startDate', 'endDate', 'clicks', 'updatedAt'],
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      label: 'Название (для админки)',
      required: true,
    },
    {
      name: 'zone',
      type: 'select',
      label: 'Зона показа',
      required: true,
      options: [
        { label: 'Шапка', value: 'header' },
        { label: 'Сайдбар', value: 'sidebar' },
        { label: 'В ленте (между постами)', value: 'feed' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'image',
      type: 'upload',
      label: 'Картинка',
      relationTo: 'media',
      required: true,
    },
    {
      name: 'link',
      type: 'text',
      label: 'Ссылка (куда ведёт клик)',
      required: true,
    },
    {
      name: 'startDate',
      type: 'date',
      label: 'Показывать с',
      admin: {
        position: 'sidebar',
        description: 'Пусто — без ограничения снизу.',
      },
    },
    {
      name: 'endDate',
      type: 'date',
      label: 'Показывать по',
      admin: {
        position: 'sidebar',
        description: 'Пусто — без ограничения сверху.',
      },
    },
    {
      name: 'active',
      type: 'checkbox',
      label: 'Активен',
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description: 'Ручной выключатель поверх периода показа.',
      },
    },
    {
      name: 'clicks',
      type: 'number',
      label: 'Кликов',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Инкрементируется redirect-роутом, вручную не править.',
      },
    },
  ],
  hooks: {
    // Инкремент clicks из redirect-роута идёт с context.disableRevalidate —
    // клики не должны сбрасывать ISR-кэш витрины.
    afterChange: [revalidatePortal],
    afterDelete: [revalidatePortalDelete],
  },
}
