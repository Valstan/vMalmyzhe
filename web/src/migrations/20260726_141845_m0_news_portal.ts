import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// M0 новостного портала (news-portal-concept §8): рубрики `sections`,
// баннеры `banners`, у постов — связь с рубрикой, галерея (rels-таблицы)
// и источник ВК (vkPostId уникален — ключ идемпотентности ingest).
// Инкрементально поверх 20260621_145321_initial (автоген payload выдаёт полную
// схему — без drizzle-снапшота; переписано руками, зеркальный .sql проверен psql).
// Плюс seed черновых рубрик из концепта §4 (финальный список — за владельцем).

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "public"."enum_banners_zone" AS ENUM('header', 'sidebar', 'feed');

  CREATE TABLE "sections" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"description" varchar,
  	"order" numeric DEFAULT 0,
  	"slug" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "banners" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"zone" "enum_banners_zone" NOT NULL,
  	"image_id" integer NOT NULL,
  	"link" varchar NOT NULL,
  	"start_date" timestamp(3) with time zone,
  	"end_date" timestamp(3) with time zone,
  	"active" boolean DEFAULT true,
  	"clicks" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "posts_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer
  );

  CREATE TABLE "_posts_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer
  );

  ALTER TABLE "posts" ADD COLUMN "section_id" integer;
  ALTER TABLE "posts" ADD COLUMN "source_vk_post_id" varchar;
  ALTER TABLE "posts" ADD COLUMN "source_source_url" varchar;
  ALTER TABLE "_posts_v" ADD COLUMN "version_section_id" integer;
  ALTER TABLE "_posts_v" ADD COLUMN "version_source_vk_post_id" varchar;
  ALTER TABLE "_posts_v" ADD COLUMN "version_source_source_url" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "sections_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "banners_id" integer;

  ALTER TABLE "posts" ADD CONSTRAINT "posts_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "posts_rels" ADD CONSTRAINT "posts_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_rels" ADD CONSTRAINT "posts_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v" ADD CONSTRAINT "_posts_v_version_section_id_sections_id_fk" FOREIGN KEY ("version_section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_posts_v_rels" ADD CONSTRAINT "_posts_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_rels" ADD CONSTRAINT "_posts_v_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "banners" ADD CONSTRAINT "banners_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sections_fk" FOREIGN KEY ("sections_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_banners_fk" FOREIGN KEY ("banners_id") REFERENCES "public"."banners"("id") ON DELETE cascade ON UPDATE no action;

  CREATE INDEX "posts_section_idx" ON "posts" USING btree ("section_id");
  CREATE UNIQUE INDEX "posts_source_source_vk_post_id_idx" ON "posts" USING btree ("source_vk_post_id");
  CREATE INDEX "posts_rels_order_idx" ON "posts_rels" USING btree ("order");
  CREATE INDEX "posts_rels_parent_idx" ON "posts_rels" USING btree ("parent_id");
  CREATE INDEX "posts_rels_path_idx" ON "posts_rels" USING btree ("path");
  CREATE INDEX "posts_rels_media_id_idx" ON "posts_rels" USING btree ("media_id");
  CREATE INDEX "_posts_v_version_version_section_idx" ON "_posts_v" USING btree ("version_section_id");
  CREATE INDEX "_posts_v_version_source_version_source_vk_post_id_idx" ON "_posts_v" USING btree ("version_source_vk_post_id");
  CREATE INDEX "_posts_v_rels_order_idx" ON "_posts_v_rels" USING btree ("order");
  CREATE INDEX "_posts_v_rels_parent_idx" ON "_posts_v_rels" USING btree ("parent_id");
  CREATE INDEX "_posts_v_rels_path_idx" ON "_posts_v_rels" USING btree ("path");
  CREATE INDEX "_posts_v_rels_media_id_idx" ON "_posts_v_rels" USING btree ("media_id");
  CREATE UNIQUE INDEX "sections_slug_idx" ON "sections" USING btree ("slug");
  CREATE INDEX "sections_updated_at_idx" ON "sections" USING btree ("updated_at");
  CREATE INDEX "sections_created_at_idx" ON "sections" USING btree ("created_at");
  CREATE INDEX "banners_image_idx" ON "banners" USING btree ("image_id");
  CREATE INDEX "banners_updated_at_idx" ON "banners" USING btree ("updated_at");
  CREATE INDEX "banners_created_at_idx" ON "banners" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_sections_id_idx" ON "payload_locked_documents_rels" USING btree ("sections_id");
  CREATE INDEX "payload_locked_documents_rels_banners_id_idx" ON "payload_locked_documents_rels" USING btree ("banners_id");

  INSERT INTO "sections" ("title", "slug", "order") VALUES
  	('Новости', 'novosti', 10),
  	('Афиша и события', 'afisha', 20),
  	('ЖКХ и благоустройство', 'zhkh', 30),
  	('Происшествия', 'proisshestviya', 40),
  	('Объявления', 'obyavleniya', 50),
  	('Культура и спорт', 'kultura-sport', 60),
  	('История Малмыжа', 'istoriya-malmyzha', 70)
  ON CONFLICT ("slug") DO NOTHING;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "posts" DROP CONSTRAINT "posts_section_id_sections_id_fk";
  ALTER TABLE "_posts_v" DROP CONSTRAINT "_posts_v_version_section_id_sections_id_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_sections_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_banners_fk";
  DROP INDEX "posts_section_idx";
  DROP INDEX "posts_source_source_vk_post_id_idx";
  DROP INDEX "_posts_v_version_version_section_idx";
  DROP INDEX "_posts_v_version_source_version_source_vk_post_id_idx";
  DROP INDEX "payload_locked_documents_rels_sections_id_idx";
  DROP INDEX "payload_locked_documents_rels_banners_id_idx";
  ALTER TABLE "posts" DROP COLUMN "section_id";
  ALTER TABLE "posts" DROP COLUMN "source_vk_post_id";
  ALTER TABLE "posts" DROP COLUMN "source_source_url";
  ALTER TABLE "_posts_v" DROP COLUMN "version_section_id";
  ALTER TABLE "_posts_v" DROP COLUMN "version_source_vk_post_id";
  ALTER TABLE "_posts_v" DROP COLUMN "version_source_source_url";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "sections_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "banners_id";
  DROP TABLE "posts_rels" CASCADE;
  DROP TABLE "_posts_v_rels" CASCADE;
  DROP TABLE "banners" CASCADE;
  DROP TABLE "sections" CASCADE;
  DROP TYPE "public"."enum_banners_zone";`)
}
