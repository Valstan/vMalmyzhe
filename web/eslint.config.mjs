// Плоский конфиг ESLint 9 (Next 16: `next lint` удалён, пресеты
// eslint-config-next — плоские массивы, FlatCompat больше не нужен;
// образец — соседняя Казанская на 16.3.5).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Собственные правила подняты до 'error' (ревизия гейтов #104): в 'warn'
      // линтер на них возвращал 0 — как гейт были пустышкой.
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
