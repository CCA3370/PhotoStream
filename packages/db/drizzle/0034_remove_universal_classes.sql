WITH invalid_classes AS (
  SELECT class_option.id
  FROM "bib_attribute_options" AS class_option
  LEFT JOIN "bib_attribute_options" AS grade_option
    ON grade_option.id = class_option.parent_grade_option_id
    AND grade_option.album_id = class_option.album_id
    AND grade_option.dimension = 'grade'
  WHERE class_option.dimension = 'class'
    AND grade_option.id IS NULL
)
DELETE FROM "bib_attribute_mappings"
WHERE "output_option_id" IN (SELECT "id" FROM invalid_classes);
--> statement-breakpoint
WITH invalid_classes AS (
  SELECT class_option.id
  FROM "bib_attribute_options" AS class_option
  LEFT JOIN "bib_attribute_options" AS grade_option
    ON grade_option.id = class_option.parent_grade_option_id
    AND grade_option.album_id = class_option.album_id
    AND grade_option.dimension = 'grade'
  WHERE class_option.dimension = 'class'
    AND grade_option.id IS NULL
)
DELETE FROM "bib_attribute_options"
WHERE "id" IN (SELECT "id" FROM invalid_classes);
--> statement-breakpoint
ALTER TABLE "bib_attribute_options" DROP CONSTRAINT IF EXISTS "bib_attribute_options_grade_parent_check";
--> statement-breakpoint
ALTER TABLE "bib_attribute_options" DROP CONSTRAINT IF EXISTS "bib_attribute_options_parent_grade_option_id_bib_attribute_options_id_fk";
--> statement-breakpoint
ALTER TABLE "bib_attribute_options" ADD CONSTRAINT "bib_attribute_options_parent_grade_option_id_bib_attribute_options_id_fk" FOREIGN KEY ("parent_grade_option_id") REFERENCES "public"."bib_attribute_options"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bib_attribute_options" ADD CONSTRAINT "bib_attribute_options_hierarchy_check" CHECK (
  ("dimension" = 'grade' AND "parent_grade_option_id" IS NULL)
  OR
  ("dimension" = 'class' AND "parent_grade_option_id" IS NOT NULL)
);
