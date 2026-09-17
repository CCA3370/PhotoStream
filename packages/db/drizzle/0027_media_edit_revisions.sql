CREATE TYPE "media_edit_revision_status" AS ENUM ('rendering', 'uploading', 'ready', 'active', 'failed', 'discarded');
CREATE TYPE "media_edit_variant_kind" AS ENUM ('photo_480', 'photo_960', 'photo_1920', 'photo_download');

CREATE TABLE "media_edit_revisions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "media_id" uuid NOT NULL,
  "created_by" uuid NOT NULL,
  "status" "media_edit_revision_status" DEFAULT 'rendering' NOT NULL,
  "based_on_revision_id" uuid,
  "based_on_generation" integer NOT NULL,
  "pipeline_version" varchar(80) NOT NULL,
  "recipe_version" integer NOT NULL,
  "recipe_json" jsonb NOT NULL,
  "denoise_model" varchar(120),
  "denoise_model_version" varchar(120),
  "deblur_model" varchar(120),
  "deblur_model_version" varchar(120),
  "source_variant_id" uuid,
  "ready_at" timestamp with time zone,
  "applied_at" timestamp with time zone,
  "failure_code" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "media_edit_variants" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "edit_revision_id" uuid NOT NULL,
  "kind" "media_edit_variant_kind" NOT NULL,
  "object_key" varchar(512) NOT NULL,
  "format" varchar(16) NOT NULL,
  "content_type" varchar(80) NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "expected_bytes" bigint NOT NULL,
  "bytes" bigint,
  "etag" varchar(128),
  "verified" boolean DEFAULT false NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "media_edit_states" (
  "media_id" uuid PRIMARY KEY NOT NULL,
  "active_revision_id" uuid,
  "pending_revision_id" uuid,
  "generation" integer DEFAULT 0 NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "media_edit_revisions"
  ADD CONSTRAINT "media_edit_revisions_media_id_media_id_fk"
  FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "media_edit_revisions"
  ADD CONSTRAINT "media_edit_revisions_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "media_edit_revisions"
  ADD CONSTRAINT "media_edit_revisions_based_on_revision_id_media_edit_revisions_id_fk"
  FOREIGN KEY ("based_on_revision_id") REFERENCES "public"."media_edit_revisions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "media_edit_revisions"
  ADD CONSTRAINT "media_edit_revisions_source_variant_id_media_variants_id_fk"
  FOREIGN KEY ("source_variant_id") REFERENCES "public"."media_variants"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "media_edit_variants"
  ADD CONSTRAINT "media_edit_variants_edit_revision_id_media_edit_revisions_id_fk"
  FOREIGN KEY ("edit_revision_id") REFERENCES "public"."media_edit_revisions"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "media_edit_states"
  ADD CONSTRAINT "media_edit_states_media_id_media_id_fk"
  FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "media_edit_states"
  ADD CONSTRAINT "media_edit_states_active_revision_id_media_edit_revisions_id_fk"
  FOREIGN KEY ("active_revision_id") REFERENCES "public"."media_edit_revisions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "media_edit_states"
  ADD CONSTRAINT "media_edit_states_pending_revision_id_media_edit_revisions_id_fk"
  FOREIGN KEY ("pending_revision_id") REFERENCES "public"."media_edit_revisions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "media_edit_states"
  ADD CONSTRAINT "media_edit_states_updated_by_users_id_fk"
  FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "media_edit_revisions_media_created_idx" ON "media_edit_revisions" USING btree ("media_id", "created_at");
CREATE INDEX "media_edit_revisions_media_status_idx" ON "media_edit_revisions" USING btree ("media_id", "status");
CREATE UNIQUE INDEX "media_edit_variants_revision_kind_unique" ON "media_edit_variants" USING btree ("edit_revision_id", "kind");
CREATE UNIQUE INDEX "media_edit_variants_object_key_unique" ON "media_edit_variants" USING btree ("object_key");
CREATE INDEX "media_edit_variants_revision_verified_idx" ON "media_edit_variants" USING btree ("edit_revision_id", "verified");
