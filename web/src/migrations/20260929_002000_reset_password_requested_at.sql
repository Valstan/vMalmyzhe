-- Payload 3.90.x (письмо brain 21.09, G388): reset_password_requested_at у
-- auth-коллекций нужен всем, даже без forgotPassword в конфиге. Nullable, без
-- DEFAULT. Применяется на прод вручную через apply-migration.yml ДО деплоя.
-- Идемпотентна (IF NOT EXISTS) — повторный прогон безвреден.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_requested_at" timestamp(3) with time zone;
