CREATE TYPE "public"."bib_ocr_status" AS ENUM('not_started', 'processing', 'completed', 'failed', 'unsupported');--> statement-breakpoint
ALTER TABLE "media_bib_reviews" ADD COLUMN "ocr_status" "bib_ocr_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_bib_reviews" ADD COLUMN "ocr_model_version" varchar(80);--> statement-breakpoint
ALTER TABLE "media_bib_reviews" ADD COLUMN "ocr_error_code" varchar(80);