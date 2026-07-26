import type { CollectionConfig } from 'payload'

import { adminOrEditor } from '../access/adminOrEditor'
import { authenticatedOrPublished } from '../access/authenticatedOrPublished'
import { populatePublishedAt } from '../hooks/populatePublishedAt'
import { revalidatePost, revalidatePostDelete } from '../hooks/revalidatePost'
import { slugField } from '../fields/slug'

// Новости сайта. Лента /news, страница /news/[slug], последние — на главной.
export const Posts: CollectionConfig<'posts'> = {
  slug: 'posts',
  labels: {
    singular: 'Новость',
    plural: 'Новости',
  },
  access: {
    create: adminOrEditor,
    delete: adminOrEditor,
    read: authenticatedOrPublished,
    update: adminOrEditor,
  },
  admin: {
    defaultColumns: ['title', 'date', 'category', 'updatedAt'],
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      label: 'Заголовок',
      required: true,
    },
    {
      name: 'date',
      type: 'date',
      label: 'Дата новости',
      admin: {
        position: 'sidebar',
        description: 'Дата, отображаемая в ленте. Если пусто — берётся дата публикации.',
      },
    },
    {
      name: 'category',
      type: 'text',
      label: 'Рубрика (текстом, legacy)',
      admin: {
        position: 'sidebar',
        description: 'Старая текстовая метка. Для новых постов используйте поле «Рубрика» (связь).',
      },
    },
    {
      name: 'section',
      type: 'relationship',
      label: 'Рубрика',
      relationTo: 'sections',
      admin: {
        position: 'sidebar',
        description: 'Рубрика портала. Ingest проставляет её по slug от классификатора.',
      },
    },
    {
      name: 'cover',
      type: 'upload',
      label: 'Обложка',
      relationTo: 'media',
    },
    {
      name: 'gallery',
      type: 'upload',
      label: 'Галерея',
      relationTo: 'media',
      hasMany: true,
      admin: {
        description: 'Все фото поста (ingest перекладывает медиа из ВК к нам).',
      },
    },
    {
      name: 'content',
      type: 'richText',
      label: 'Текст новости',
    },
    {
      name: 'publishedAt',
      type: 'date',
      label: 'Дата публикации',
      admin: {
        position: 'sidebar',
      },
    },
    slugField(),
    // Источник поста в ВК (конвейер Сарафана, news-portal-concept §3).
    // Для перенесённых из ВК постов sourceUrl обязателен — атрибуция оригинала
    // (страховка по читательскому/перепечатанному контенту, концепт §9).
    {
      name: 'source',
      type: 'group',
      label: 'Источник (ВК)',
      admin: {
        position: 'sidebar',
      },
      fields: [
        {
          name: 'vkPostId',
          type: 'text',
          label: 'VK post ID',
          unique: true,
          index: true,
          admin: {
            description: 'Ключ идемпотентности ingest — повторная доставка не создаёт дубль.',
          },
        },
        {
          name: 'sourceUrl',
          type: 'text',
          label: 'Ссылка на оригинал',
          validate: (value: string | null | undefined, { siblingData }: { siblingData?: { vkPostId?: string | null } }) => {
            if (siblingData?.vkPostId && !value) {
              return 'Для поста из ВК обязательна ссылка на оригинал.'
            }
            return true
          },
        },
      ],
    },
  ],
  hooks: {
    beforeChange: [populatePublishedAt],
    afterChange: [revalidatePost],
    afterDelete: [revalidatePostDelete],
  },
  versions: {
    drafts: true,
  },
}
