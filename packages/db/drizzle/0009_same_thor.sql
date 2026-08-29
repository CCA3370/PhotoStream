ALTER TABLE "albums" ALTER COLUMN "bib_model_version" SET DEFAULT 'ppocrv6-tiny-0.4.2-ff6ab415-1e13b227';--> statement-breakpoint
UPDATE "albums"
SET "bib_model_version" = 'ppocrv6-tiny-0.4.2-ff6ab415-1e13b227'
WHERE "bib_model_version" = 'PP-OCRv6-tiny-2026-08';
