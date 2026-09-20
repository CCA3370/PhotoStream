ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'operator' AFTER 'admin';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assign_media_review_assignee()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('review-collaboration:' || NEW.album_id::text, 0)
  );

  SELECT collaborator.user_id
  INTO NEW.review_assignee_id
  FROM album_review_collaborators AS collaborator
  INNER JOIN users AS reviewer
    ON reviewer.id = collaborator.user_id
   AND reviewer.is_active = true
   AND reviewer.role IN ('admin', 'operator', 'reviewer')
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
