ALTER TABLE "media" ADD COLUMN "review_assignee_id" uuid;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "media"
SET "reviewed_at" = COALESCE("published_at", "hidden_at", "updated_at", "created_at", now())
WHERE "publication_status" IN ('published', 'hidden');
--> statement-breakpoint
CREATE TABLE "album_review_collaborators" (
  "album_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "album_review_collaborators" ADD CONSTRAINT "album_review_collaborators_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "album_review_collaborators" ADD CONSTRAINT "album_review_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_review_assignee_id_users_id_fk" FOREIGN KEY ("review_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "album_review_collaborators_album_user_unique" ON "album_review_collaborators" USING btree ("album_id","user_id");
--> statement-breakpoint
CREATE INDEX "album_review_collaborators_album_idx" ON "album_review_collaborators" USING btree ("album_id","user_id");
--> statement-breakpoint
CREATE INDEX "media_album_review_assignee_idx" ON "media" USING btree ("album_id","review_assignee_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "media_album_review_workload_idx" ON "media" USING btree ("album_id","review_assignee_id","reviewed_at") WHERE "reviewed_at" IS NULL AND "publication_status" <> 'deleted';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mark_media_reviewed_on_publish()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reviewed_at IS NULL
     AND NEW.publication_status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.publication_status IS DISTINCT FROM 'published') THEN
    NEW.reviewed_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "media_mark_reviewed_on_publish"
BEFORE INSERT OR UPDATE OF "publication_status" ON "media"
FOR EACH ROW
EXECUTE FUNCTION mark_media_reviewed_on_publish();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assign_media_review_assignee()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Serialize assignment with collaboration reconfiguration and concurrent uploads.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('review-collaboration:' || NEW.album_id::text, 0)
  );

  SELECT collaborator.user_id
  INTO NEW.review_assignee_id
  FROM album_review_collaborators AS collaborator
  INNER JOIN users AS reviewer
    ON reviewer.id = collaborator.user_id
   AND reviewer.is_active = true
   AND reviewer.role IN ('admin', 'reviewer')
  LEFT JOIN (
    SELECT review_assignee_id, count(*) AS assigned_count
    FROM media
    WHERE album_id = NEW.album_id
      AND publication_status <> 'deleted'
      AND reviewed_at IS NULL
      AND review_assignee_id IS NOT NULL
    GROUP BY review_assignee_id
  ) AS counts ON counts.review_assignee_id = collaborator.user_id
  WHERE collaborator.album_id = NEW.album_id
  ORDER BY COALESCE(counts.assigned_count, 0), collaborator.user_id
  LIMIT 1;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "media_assign_review_assignee"
BEFORE INSERT ON "media"
FOR EACH ROW
EXECUTE FUNCTION assign_media_review_assignee();
