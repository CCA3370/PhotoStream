CREATE TABLE "media_micro_previews" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"album_id" uuid NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"format" varchar(16) NOT NULL,
	"content_type" varchar(80) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"expected_bytes" bigint NOT NULL,
	"bytes" bigint,
	"etag" varchar(128),
	"verified" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "media_micro_previews_object_key_unique" ON "media_micro_previews" USING btree ("object_key");
--> statement-breakpoint
CREATE INDEX "media_micro_previews_album_verified_idx" ON "media_micro_previews" USING btree ("album_id","verified","media_id");
