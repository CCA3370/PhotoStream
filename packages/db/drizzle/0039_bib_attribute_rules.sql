DROP TABLE IF EXISTS "bib_attribute_mapping_ranges";
--> statement-breakpoint
DROP TABLE IF EXISTS "bib_attribute_mappings";
--> statement-breakpoint
CREATE TABLE "bib_attribute_rules" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "album_id" uuid NOT NULL,
  "dimension" "bib_attribute_dimension" NOT NULL,
  "start_position" integer NOT NULL,
  "width" integer NOT NULL,
  "first_value" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bib_attribute_rules" ADD CONSTRAINT "bib_attribute_rules_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "bib_attribute_rules_album_dimension_unique" ON "bib_attribute_rules" USING btree ("album_id","dimension");
