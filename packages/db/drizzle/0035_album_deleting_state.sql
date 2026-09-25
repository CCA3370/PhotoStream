ALTER TYPE "public"."album_state" ADD VALUE IF NOT EXISTS 'deleting';

CREATE TABLE IF NOT EXISTS "album_object_deletion_sweeps" (
  "album_id" uuid PRIMARY KEY NOT NULL,
  "object_prefix" varchar(512) NOT NULL,
  "execute_after" timestamp with time zone NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error_code" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "album_object_deletion_sweeps_due_idx"
  ON "album_object_deletion_sweeps" USING btree ("execute_after");

CREATE TABLE IF NOT EXISTS "face_reference_deletion_sweeps" (
  "object_key" varchar(512) PRIMARY KEY NOT NULL,
  "execute_after" timestamp with time zone NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error_code" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "face_reference_deletion_sweeps_due_idx"
  ON "face_reference_deletion_sweeps" USING btree ("execute_after");
