CREATE TABLE IF NOT EXISTS "album_deletion_errors" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "album_id" uuid NOT NULL,
  "source" varchar(40) NOT NULL,
  "stage" varchar(80) NOT NULL,
  "operation" varchar(120) NOT NULL,
  "code" varchar(200),
  "message" text NOT NULL,
  "provider_request_id" varchar(256),
  "http_status" integer,
  "attempt" integer DEFAULT 1 NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "album_deletion_errors_album_id_albums_id_fk"
    FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "album_deletion_errors_album_time_idx"
  ON "album_deletion_errors" USING btree ("album_id", "occurred_at");

INSERT INTO "album_deletion_errors" (
  "album_id",
  "source",
  "stage",
  "operation",
  "code",
  "message",
  "attempt",
  "details",
  "occurred_at"
)
SELECT
  "album_id",
  'object_storage',
  'object_cleanup',
  'UnknownObjectCleanupOperation',
  "last_error_code",
  '此前删除重试失败；旧版本未保留该次错误的完整原始信息。',
  GREATEST("attempts", 1),
  jsonb_build_object('backfilled', true),
  "updated_at"
FROM "album_object_deletion_sweeps"
WHERE "last_error_code" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "album_deletion_errors" existing
    WHERE existing."album_id" = "album_object_deletion_sweeps"."album_id"
      AND existing."occurred_at" = "album_object_deletion_sweeps"."updated_at"
      AND existing."code" = "album_object_deletion_sweeps"."last_error_code"
  );
