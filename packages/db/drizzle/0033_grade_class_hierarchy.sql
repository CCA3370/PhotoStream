ALTER TABLE "bib_attribute_options" ADD COLUMN "parent_grade_option_id" uuid;
--> statement-breakpoint
ALTER TABLE "bib_attribute_options" ADD CONSTRAINT "bib_attribute_options_parent_grade_option_id_bib_attribute_options_id_fk" FOREIGN KEY ("parent_grade_option_id") REFERENCES "public"."bib_attribute_options"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bib_attribute_options" ADD CONSTRAINT "bib_attribute_options_grade_parent_check" CHECK ("dimension" = 'class' OR "parent_grade_option_id" IS NULL);
--> statement-breakpoint
CREATE INDEX "bib_attribute_options_parent_grade_sort_idx" ON "bib_attribute_options" USING btree ("album_id","parent_grade_option_id","sort_order","id");
