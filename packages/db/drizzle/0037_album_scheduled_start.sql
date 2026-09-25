ALTER TABLE "albums"
  ADD COLUMN IF NOT EXISTS "scheduled_start_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "albums_scheduled_start_idx"
  ON "albums" USING btree ("state", "scheduled_start_at");
