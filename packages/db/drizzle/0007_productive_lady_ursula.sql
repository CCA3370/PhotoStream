CREATE TYPE "public"."bib_attribute_dimension" AS ENUM('grade', 'class');--> statement-breakpoint
CREATE TYPE "public"."bib_recalculation_kind" AS ENUM('rule', 'mapping');--> statement-breakpoint
CREATE TYPE "public"."bib_recalculation_status" AS ENUM('pending', 'processing', 'failed', 'completed');--> statement-breakpoint
CREATE TYPE "public"."bib_review_decision" AS ENUM('pending', 'numbers_confirmed', 'no_number_confirmed', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."bib_tag_source" AS ENUM('ocr', 'manual');--> statement-breakpoint
CREATE TYPE "public"."bib_tag_status" AS ENUM('suggested', 'confirmed', 'rejected', 'needs_review');--> statement-breakpoint
CREATE TABLE "bib_allowed_ranges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"constraint_id" uuid NOT NULL,
	"start_value" varchar(12) NOT NULL,
	"end_value" varchar(12) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bib_attribute_mapping_ranges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mapping_id" uuid NOT NULL,
	"start_value" varchar(12) NOT NULL,
	"end_value" varchar(12) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bib_attribute_mappings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"dimension" "bib_attribute_dimension" NOT NULL,
	"start_position" integer NOT NULL,
	"width" integer NOT NULL,
	"output_option_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bib_attribute_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"album_id" uuid NOT NULL,
	"dimension" "bib_attribute_dimension" NOT NULL,
	"display_name" varchar(60) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bib_constraints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"pattern_id" uuid NOT NULL,
	"start_position" integer NOT NULL,
	"width" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bib_patterns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"total_length" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bib_recalculation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"kind" "bib_recalculation_kind" NOT NULL,
	"target_version" integer NOT NULL,
	"status" "bib_recalculation_status" DEFAULT 'pending' NOT NULL,
	"cursor_tag_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(100),
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_bib_reviews" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"decision" "bib_review_decision" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" varchar(100) DEFAULT 'created' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_bib_tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"number_ciphertext" text NOT NULL,
	"number_iv" varchar(32) NOT NULL,
	"number_auth_tag" varchar(32) NOT NULL,
	"blind_index" varchar(64) NOT NULL,
	"key_version" varchar(40) NOT NULL,
	"status" "bib_tag_status" NOT NULL,
	"source" "bib_tag_source" NOT NULL,
	"confidence_basis_points" integer,
	"quadrilateral" jsonb,
	"rule_version" integer NOT NULL,
	"model_version" varchar(80),
	"grade_option_id" uuid,
	"class_option_id" uuid,
	"mapping_version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "bib_rule_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "bib_mapping_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "bib_model_version" varchar(80) DEFAULT 'PP-OCRv6-tiny-2026-08' NOT NULL;--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "bib_rule_usable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "bib_mapping_usable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bib_allowed_ranges" ADD CONSTRAINT "bib_allowed_ranges_constraint_id_bib_constraints_id_fk" FOREIGN KEY ("constraint_id") REFERENCES "public"."bib_constraints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bib_attribute_mapping_ranges" ADD CONSTRAINT "bib_attribute_mapping_ranges_mapping_id_bib_attribute_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."bib_attribute_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bib_attribute_mappings" ADD CONSTRAINT "bib_attribute_mappings_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bib_attribute_mappings" ADD CONSTRAINT "bib_attribute_mappings_output_option_id_bib_attribute_options_id_fk" FOREIGN KEY ("output_option_id") REFERENCES "public"."bib_attribute_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bib_attribute_options" ADD CONSTRAINT "bib_attribute_options_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bib_constraints" ADD CONSTRAINT "bib_constraints_pattern_id_bib_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."bib_patterns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bib_patterns" ADD CONSTRAINT "bib_patterns_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bib_recalculation_tasks" ADD CONSTRAINT "bib_recalculation_tasks_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_bib_reviews" ADD CONSTRAINT "media_bib_reviews_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_bib_reviews" ADD CONSTRAINT "media_bib_reviews_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_bib_tags" ADD CONSTRAINT "media_bib_tags_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_bib_tags" ADD CONSTRAINT "media_bib_tags_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_bib_tags" ADD CONSTRAINT "media_bib_tags_grade_option_id_bib_attribute_options_id_fk" FOREIGN KEY ("grade_option_id") REFERENCES "public"."bib_attribute_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_bib_tags" ADD CONSTRAINT "media_bib_tags_class_option_id_bib_attribute_options_id_fk" FOREIGN KEY ("class_option_id") REFERENCES "public"."bib_attribute_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_bib_tags" ADD CONSTRAINT "media_bib_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_bib_tags" ADD CONSTRAINT "media_bib_tags_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bib_allowed_ranges_constraint_values_unique" ON "bib_allowed_ranges" USING btree ("constraint_id","start_value","end_value");--> statement-breakpoint
CREATE UNIQUE INDEX "bib_attribute_mapping_ranges_values_unique" ON "bib_attribute_mapping_ranges" USING btree ("mapping_id","start_value","end_value");--> statement-breakpoint
CREATE INDEX "bib_attribute_mappings_album_dimension_sort_idx" ON "bib_attribute_mappings" USING btree ("album_id","dimension","sort_order","id");--> statement-breakpoint
CREATE INDEX "bib_attribute_options_album_dimension_sort_idx" ON "bib_attribute_options" USING btree ("album_id","dimension","sort_order","id");--> statement-breakpoint
CREATE INDEX "bib_constraints_pattern_sort_idx" ON "bib_constraints" USING btree ("pattern_id","sort_order","id");--> statement-breakpoint
CREATE INDEX "bib_patterns_album_sort_idx" ON "bib_patterns" USING btree ("album_id","sort_order","id");--> statement-breakpoint
CREATE UNIQUE INDEX "bib_recalculation_album_kind_version_unique" ON "bib_recalculation_tasks" USING btree ("album_id","kind","target_version");--> statement-breakpoint
CREATE INDEX "bib_recalculation_poll_idx" ON "bib_recalculation_tasks" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_bib_tags_confirmed_number_unique" ON "media_bib_tags" USING btree ("media_id","blind_index") WHERE "media_bib_tags"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "media_bib_tags_media_status_idx" ON "media_bib_tags" USING btree ("media_id","status","created_at");--> statement-breakpoint
CREATE INDEX "media_bib_tags_public_search_idx" ON "media_bib_tags" USING btree ("album_id","blind_index","status","rule_version");--> statement-breakpoint
CREATE INDEX "media_bib_tags_attribute_filter_idx" ON "media_bib_tags" USING btree ("album_id","status","mapping_version","grade_option_id","class_option_id");