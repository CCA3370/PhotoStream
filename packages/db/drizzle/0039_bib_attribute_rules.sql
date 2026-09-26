DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "bib_attribute_mappings" LIMIT 1) THEN
    RAISE EXCEPTION 'bib attribute rule migration requires empty legacy mappings; migrate or clear the legacy configuration before deploying';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "bib_attribute_options" ADD COLUMN "ordinal" integer;
--> statement-breakpoint
UPDATE "bib_attribute_options" SET "ordinal" = "sort_order" WHERE "ordinal" IS NULL;
--> statement-breakpoint
CREATE INDEX "bib_attribute_options_album_dimension_ordinal_idx" ON "bib_attribute_options" USING btree ("album_id","dimension","ordinal","id");
--> statement-breakpoint
CREATE INDEX "bib_attribute_options_parent_grade_ordinal_idx" ON "bib_attribute_options" USING btree ("album_id","parent_grade_option_id","ordinal","id");
--> statement-breakpoint
CREATE TABLE "bib_attribute_rules" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "album_id" uuid NOT NULL,
  "dimension" "bib_attribute_dimension" NOT NULL,
  "start_position" integer NOT NULL,
  "width" integer NOT NULL,
  "first_value" bigint DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bib_attribute_rules" ADD CONSTRAINT "bib_attribute_rules_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "bib_attribute_rules_album_dimension_unique" ON "bib_attribute_rules" USING btree ("album_id","dimension");
