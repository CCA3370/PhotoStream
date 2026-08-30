DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "media" WHERE "kind" = 'video')
		OR EXISTS (SELECT 1 FROM "media_variants" WHERE "kind" IN ('video_poster_480', 'video_poster_960', 'video_source'))
		OR EXISTS (SELECT 1 FROM "deletion_task_objects" WHERE "variant_kind" IN ('video_poster_480', 'video_poster_960', 'video_source'))
		OR EXISTS (SELECT 1 FROM "analytics_events" WHERE "variant_kind" IN ('video_poster_480', 'video_poster_960', 'video_source')) THEN
		RAISE EXCEPTION 'video retirement migration requires an empty video data boundary';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "analytics_events" ALTER COLUMN "variant_kind" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "deletion_task_objects" ALTER COLUMN "variant_kind" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "media_variants" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."variant_kind";--> statement-breakpoint
CREATE TYPE "public"."variant_kind" AS ENUM('photo_480', 'photo_960', 'photo_1920', 'photo_original');--> statement-breakpoint
ALTER TABLE "analytics_events" ALTER COLUMN "variant_kind" SET DATA TYPE "public"."variant_kind" USING "variant_kind"::"public"."variant_kind";--> statement-breakpoint
ALTER TABLE "deletion_task_objects" ALTER COLUMN "variant_kind" SET DATA TYPE "public"."variant_kind" USING "variant_kind"::"public"."variant_kind";--> statement-breakpoint
ALTER TABLE "media_variants" ALTER COLUMN "kind" SET DATA TYPE "public"."variant_kind" USING "kind"::"public"."variant_kind";--> statement-breakpoint
ALTER TABLE "albums" DROP COLUMN "video_download_enabled";--> statement-breakpoint
ALTER TABLE "media" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "media" DROP COLUMN "duration_ms";--> statement-breakpoint
DROP TYPE "public"."media_kind";--> statement-breakpoint
ALTER INDEX "media_variants_media_kind_unique" RENAME TO "media_variants_media_variant_unique";
