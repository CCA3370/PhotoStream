ALTER TABLE "bib_attribute_options" ADD COLUMN IF NOT EXISTS "ordinal" integer;
--> statement-breakpoint
UPDATE "bib_attribute_options" SET "ordinal" = "sort_order" WHERE "ordinal" IS NULL;
--> statement-breakpoint
ALTER TABLE "bib_attribute_rules" ALTER COLUMN "first_value" TYPE bigint USING "first_value"::bigint;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bib_attribute_options_album_dimension_ordinal_idx" ON "bib_attribute_options" USING btree ("album_id","dimension","ordinal","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bib_attribute_options_parent_grade_ordinal_idx" ON "bib_attribute_options" USING btree ("album_id","parent_grade_option_id","ordinal","id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bib_attribute_mappings" (
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
CREATE TABLE IF NOT EXISTS "bib_attribute_mapping_ranges" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "mapping_id" uuid NOT NULL,
  "start_value" varchar(12) NOT NULL,
  "end_value" varchar(12) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bib_attribute_mappings_album_id_albums_id_fk') THEN
    ALTER TABLE "bib_attribute_mappings" ADD CONSTRAINT "bib_attribute_mappings_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bib_attribute_mappings_output_option_id_bib_attribute_options_id_fk') THEN
    ALTER TABLE "bib_attribute_mappings" ADD CONSTRAINT "bib_attribute_mappings_output_option_id_bib_attribute_options_id_fk" FOREIGN KEY ("output_option_id") REFERENCES "public"."bib_attribute_options"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bib_attribute_mapping_ranges_mapping_id_bib_attribute_mappings_id_fk') THEN
    ALTER TABLE "bib_attribute_mapping_ranges" ADD CONSTRAINT "bib_attribute_mapping_ranges_mapping_id_bib_attribute_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."bib_attribute_mappings"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bib_attribute_mappings_album_dimension_sort_idx" ON "bib_attribute_mappings" USING btree ("album_id","dimension","sort_order","id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bib_attribute_mapping_ranges_values_unique" ON "bib_attribute_mapping_ranges" USING btree ("mapping_id","start_value","end_value");
