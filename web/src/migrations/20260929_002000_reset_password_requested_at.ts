import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Payload 3.90.x (письмо brain 21.09, G388): у auth-коллекций появляется поле
// `resetPasswordRequestedAt` — троттлинг forgot-password. Дефолт
// `minRequestInterval ?? 15000` ставится ДО гейта, поэтому колонка нужна ВСЕМ,
// даже без секции `forgotPassword` в конфиге: без неё первое обращение к
// auth-коллекции падает. Наша auth-коллекция — `users` (Users.auth: true).
// Nullable, без DEFAULT — как и у соседних resetPassword*/lockout-колонок.
// Зеркальный .sql применён на прод вручную через apply-migration.yml ДО деплоя.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_requested_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "users" DROP COLUMN IF EXISTS "reset_password_requested_at";`)
}
