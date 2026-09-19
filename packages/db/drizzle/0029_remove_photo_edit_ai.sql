UPDATE "media_edit_revisions"
SET "recipe_json" = "recipe_json" - 'denoiseStrength' - 'deblurStrength'
WHERE "recipe_json" ? 'denoiseStrength' OR "recipe_json" ? 'deblurStrength';
--> statement-breakpoint
ALTER TABLE "media_edit_revisions" DROP COLUMN IF EXISTS "denoise_model";
--> statement-breakpoint
ALTER TABLE "media_edit_revisions" DROP COLUMN IF EXISTS "denoise_model_version";
--> statement-breakpoint
ALTER TABLE "media_edit_revisions" DROP COLUMN IF EXISTS "deblur_model";
--> statement-breakpoint
ALTER TABLE "media_edit_revisions" DROP COLUMN IF EXISTS "deblur_model_version";
