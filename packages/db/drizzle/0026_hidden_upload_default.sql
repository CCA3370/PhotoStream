UPDATE "media"
SET
  "publication_status" = 'hidden',
  "publish_sequence" = NULL,
  "published_at" = NULL,
  "hidden_at" = COALESCE("hidden_at", NOW()),
  "updated_at" = NOW()
WHERE "publication_status" IN ('draft', 'pending_review');
