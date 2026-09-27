ALTER TABLE "albums" ADD COLUMN "review_revision" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "albums" ALTER COLUMN "preview_download_enabled" SET DEFAULT true;
--> statement-breakpoint
ALTER TABLE "albums" ALTER COLUMN "original_download_enabled" SET DEFAULT true;
--> statement-breakpoint
UPDATE "albums"
SET "preview_download_enabled" = true,
    "original_download_enabled" = true
WHERE "preview_download_enabled" = false
   OR "original_download_enabled" = false;
--> statement-breakpoint
CREATE TABLE "analytics_visitor_days" (
  "album_id" uuid NOT NULL,
  "day" date NOT NULL,
  "visitor_digest" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_visitor_days"
  ADD CONSTRAINT "analytics_visitor_days_album_id_albums_id_fk"
  FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_visitor_days_album_day_visitor_unique"
  ON "analytics_visitor_days" USING btree ("album_id","day","visitor_digest");
--> statement-breakpoint
CREATE INDEX "analytics_visitor_days_album_visitor_day_idx"
  ON "analytics_visitor_days" USING btree ("album_id","visitor_digest","day");
--> statement-breakpoint
CREATE INDEX "analytics_visitor_days_retention_idx"
  ON "analytics_visitor_days" USING btree ("created_at");
--> statement-breakpoint
INSERT INTO "analytics_visitor_days" ("album_id","day","visitor_digest","created_at")
SELECT "album_id","day","visitor_digest",min("created_at")
FROM "analytics_events"
GROUP BY "album_id","day","visitor_digest"
ON CONFLICT ("album_id","day","visitor_digest") DO NOTHING;
--> statement-breakpoint
UPDATE "analytics_daily" AS d
SET "unique_visitors" = (
  SELECT count(*)::int
  FROM "analytics_visitor_days" AS v
  WHERE v."album_id" = d."album_id"
    AND v."day" = d."day"
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION photostream_bump_review_revision_direct()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_album_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_album_id := OLD.album_id;
  ELSE
    target_album_id := NEW.album_id;
  END IF;
  UPDATE albums
  SET review_revision = review_revision + 1
  WHERE id = target_album_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION photostream_bump_review_revision_via_media()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_media_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_media_id := OLD.media_id;
  ELSE
    target_media_id := NEW.media_id;
  END IF;
  UPDATE albums AS a
  SET review_revision = a.review_revision + 1
  FROM media AS m
  WHERE m.id = target_media_id
    AND a.id = m.album_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION photostream_bump_review_revision_for_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE albums AS a
  SET review_revision = a.review_revision + 1
  WHERE EXISTS (
    SELECT 1
    FROM album_review_collaborators AS c
    WHERE c.album_id = a.id
      AND c.user_id = NEW.id
  )
  OR EXISTS (
    SELECT 1
    FROM media AS m
    WHERE m.album_id = a.id
      AND m.uploader_id = NEW.id
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER album_review_collaborators_review_revision
AFTER INSERT OR UPDATE OR DELETE ON "album_review_collaborators"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_direct();
--> statement-breakpoint
CREATE TRIGGER media_review_revision
AFTER INSERT OR UPDATE OR DELETE ON "media"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_direct();
--> statement-breakpoint
CREATE TRIGGER categories_review_revision
AFTER INSERT OR UPDATE OR DELETE ON "categories"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_direct();
--> statement-breakpoint
CREATE TRIGGER media_bib_tags_review_revision
AFTER INSERT OR UPDATE OR DELETE ON "media_bib_tags"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_direct();
--> statement-breakpoint
CREATE TRIGGER media_variants_review_revision
AFTER INSERT OR UPDATE OR DELETE ON "media_variants"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_via_media();
--> statement-breakpoint
CREATE TRIGGER featured_media_review_revision
AFTER INSERT OR UPDATE OR DELETE ON "featured_media"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_via_media();
--> statement-breakpoint
CREATE TRIGGER media_bib_reviews_review_revision
AFTER INSERT OR UPDATE OR DELETE ON "media_bib_reviews"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_via_media();
--> statement-breakpoint
CREATE TRIGGER media_edit_states_review_revision
AFTER INSERT OR UPDATE OR DELETE ON "media_edit_states"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_via_media();
--> statement-breakpoint
CREATE TRIGGER media_edit_revisions_review_revision
AFTER INSERT OR UPDATE OR DELETE ON "media_edit_revisions"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_via_media();
--> statement-breakpoint
CREATE TRIGGER deletion_tasks_review_revision
AFTER INSERT OR UPDATE OR DELETE ON "deletion_tasks"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_via_media();
--> statement-breakpoint
CREATE TRIGGER users_review_revision
AFTER UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION photostream_bump_review_revision_for_user();
