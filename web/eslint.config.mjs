import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Собственные правила подняты до 'error' (ревизия гейтов #104): в 'warn'
      // next lint на них возвращал 0 — как гейт они были пустышкой.
      // Красные прогоны показаны: ban-ts-comment/any/unused — нарочно внесённые
      // нарушения падают с exit 1, откачено.
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  {
    // Сгенерированные Payload-миграции сигнатуры up({db,payload,req}) держат
    // все три аргумента, даже если используется один — так их генерирует кли.
    // Отключаем no-unused-vars, чтобы не чистить такие файлы вручную.
    files: ['src/migrations/**'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    ignores: ['.next/'],
  },
]

export default eslintConfig
