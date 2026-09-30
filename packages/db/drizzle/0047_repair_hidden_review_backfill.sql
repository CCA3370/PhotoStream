-- Hidden visibility is the default for uploads. Migration 0030 incorrectly
-- inferred review from it. Recover only its exact hidden timestamp fingerprint,
-- preserving explicit review/visibility decisions and any publication history.
DO $$
DECLARE
  repair_album_id uuid;
BEGIN
  -- Use the same lock as uploads, collaboration settings and explicit review.
  -- Sort albums so concurrent repairs acquire multiple locks consistently.
  FOR repair_album_id IN
    SELECT DISTINCT album_id
    FROM media
    WHERE publication_status = 'hidden'
      AND published_at IS NULL
      AND publish_sequence IS NULL
      AND reviewed_at IS NOT NULL
      AND reviewed_at = hidden_at
    ORDER BY album_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('review-collaboration:' || repair_album_id::text, 0)
    );
  END LOOP;

  UPDATE media AS target
  SET reviewed_at = NULL,
      updated_at = now()
  WHERE target.publication_status = 'hidden'
    AND target.published_at IS NULL
    AND target.publish_sequence IS NULL
    AND target.reviewed_at IS NOT NULL
    AND target.reviewed_at = target.hidden_at
    AND NOT EXISTS (
      SELECT 1
      FROM audit_logs AS audit
      WHERE audit.target_type = 'media'
        AND audit.target_id = target.id
        AND audit.result = 'success'
        AND audit.action IN (
          'media.reviewed', 'media.published', 'media.hidden', 'media.restored'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM live_events AS event
      WHERE event.media_id = target.id
        AND event.type IN ('media.published', 'media.hidden', 'media.restored')
    );
END;
$$;
