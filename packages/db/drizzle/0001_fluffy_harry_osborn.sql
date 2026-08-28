CREATE TYPE "public"."album_access" AS ENUM('password', 'public');--> statement-breakpoint
CREATE TYPE "public"."album_state" AS ENUM('draft', 'live', 'ended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('created', 'local_processing', 'uploading_preview', 'preview_ready', 'uploading_source', 'ready', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('photo', 'video');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('draft', 'pending_review', 'published', 'hidden', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."publish_mode" AS ENUM('review', 'auto');--> statement-breakpoint
CREATE TYPE "public"."upload_intent_status" AS ENUM('active', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."variant_kind" AS ENUM('photo_480', 'photo_960', 'photo_1920', 'photo_original', 'video_poster_480', 'video_poster_960', 'video_source');--> statement-breakpoint
CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" varchar(32) NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" varchar(1000) DEFAULT '' NOT NULL,
	"state" "album_state" DEFAULT 'draft' NOT NULL,
	"access" "album_access" DEFAULT 'password' NOT NULL,
	"publish_mode" "publish_mode" DEFAULT 'review' NOT NULL,
	"password_hash" text,
	"access_version" integer DEFAULT 1 NOT NULL,
	"preview_download_enabled" boolean DEFAULT false NOT NULL,
	"original_download_enabled" boolean DEFAULT false NOT NULL,
	"video_download_enabled" boolean DEFAULT false NOT NULL,
	"bib_recognition_enabled" boolean DEFAULT false NOT NULL,
	"bib_search_enabled" boolean DEFAULT false NOT NULL,
	"publish_sequence" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"album_id" uuid NOT NULL,
	"type" varchar(80) NOT NULL,
	"media_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"category_id" uuid,
	"kind" "media_kind" NOT NULL,
	"uploader_id" uuid NOT NULL,
	"ingest_status" "ingest_status" DEFAULT 'created' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_ms" integer,
	"media_type" varchar(80) NOT NULL,
	"total_bytes" bigint NOT NULL,
	"captured_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"publish_sequence" bigint,
	"published_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"failure_code" varchar(80),
	"retryable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_variants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"media_id" uuid NOT NULL,
	"kind" "variant_kind" NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"format" varchar(16) NOT NULL,
	"content_type" varchar(80) NOT NULL,
	"width" integer,
	"height" integer,
	"expected_bytes" bigint NOT NULL,
	"bytes" bigint,
	"etag" varchar(128),
	"verified" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"media_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"status" "upload_intent_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"album_id" uuid NOT NULL,
	"access_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_events" ADD CONSTRAINT "live_events_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_events" ADD CONSTRAINT "live_events_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "albums_slug_unique" ON "albums" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "albums_creator_idempotency_unique" ON "albums" USING btree ("created_by","idempotency_key");--> statement-breakpoint
CREATE INDEX "albums_state_updated_idx" ON "albums" USING btree ("state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_album_name_unique" ON "categories" USING btree ("album_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_creator_idempotency_unique" ON "categories" USING btree ("album_id","created_by","idempotency_key");--> statement-breakpoint
CREATE INDEX "categories_album_sort_idx" ON "categories" USING btree ("album_id","enabled","sort_order");--> statement-breakpoint
CREATE INDEX "live_events_album_id_idx" ON "live_events" USING btree ("album_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_album_publish_sequence_unique" ON "media" USING btree ("album_id","publish_sequence") WHERE "media"."publish_sequence" is not null;--> statement-breakpoint
CREATE INDEX "media_album_public_cursor_idx" ON "media" USING btree ("album_id","publication_status","publish_sequence","id");--> statement-breakpoint
CREATE INDEX "media_album_ingest_idx" ON "media" USING btree ("album_id","ingest_status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_variants_media_kind_unique" ON "media_variants" USING btree ("media_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "media_variants_object_key_unique" ON "media_variants" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "media_variants_media_verified_idx" ON "media_variants" USING btree ("media_id","verified");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_intents_uploader_idempotency_unique" ON "upload_intents" USING btree ("uploader_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_intents_media_unique" ON "upload_intents" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "upload_intents_expiry_idx" ON "upload_intents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_sessions_token_hash_unique" ON "visitor_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "visitor_sessions_album_expiry_idx" ON "visitor_sessions" USING btree ("album_id","expires_at");