import type { CollectionConfig, TextField } from 'payload'

import { adminOrEditor } from '../access/adminOrEditor'
import { anyone } from '../access/anyone'
import { revalidatePortal, revalidatePortalDelete } from '../hooks/revalidatePortal'
import { slugField } from '../fields/slug'

// Рубрики новостного портала (M0 news-portal-concept §4). Управляемый список,
// не хардкод: классификатор Сарафана мапится на slug, финальный набор рубрик
// владелец правит по живой статистике. Черновой seed — в migrations.
export const Sections: CollectionConfig = {
  slug: 'sections',
  labels: {
    singular: 'Рубрика',
    plural: 'Рубрики',
  },
  access: {
    create: adminOrEditor,
    delete: adminOrEditor,
    read: anyone,
    update: adminOrEditor,
  },
  admin: {
    defaultColumns: ['title', 'slug', 'order', 'updatedAt'],
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      label: 'Название',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Описание',
      admin: {
        description: 'Необязательный подзаголовок для страницы рубрики.',
      },
    },
    {
      name: 'order',
      type: 'number',
      label: 'Порядок',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        description: 'Меньше — выше в меню/списках.',
      },
    },
    // Классификатор адресует рубрику по slug — он обязателен и уникален.
    { ...(slugField() as TextField), required: true, unique: true },
  ],
  hooks: {
    afterChange: [revalidatePortal],
    afterDelete: [revalidatePortalDelete],
  },
}
