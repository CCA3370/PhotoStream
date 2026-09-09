CREATE TABLE "media_delivery_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"album_id" uuid NOT NULL,
	"memory_hits" integer DEFAULT 0 NOT NULL,
	"memory_bytes" bigint DEFAULT 0 NOT NULL,
	"disk_hits" integer DEFAULT 0 NOT NULL,
	"disk_bytes" bigint DEFAULT 0 NOT NULL,
	"joined_requests" integer DEFAULT 0 NOT NULL,
	"network_requests" integer DEFAULT 0 NOT NULL,
	"network_bytes" bigint DEFAULT 0 NOT NULL,
	"read_failures" integer DEFAULT 0 NOT NULL,
	"write_failures" integer DEFAULT 0 NOT NULL,
	"size_mismatches" integer DEFAULT 0 NOT NULL,
	"refreshed_urls" integer DEFAULT 0 NOT NULL,
	"evictions" integer DEFAULT 0 NOT NULL,
	"direct_fallbacks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "media_delivery_events" ADD CONSTRAINT "media_delivery_events_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_delivery_events_album_created_idx" ON "media_delivery_events" USING btree ("album_id","created_at");--> statement-breakpoint
CREATE INDEX "media_delivery_events_retention_idx" ON "media_delivery_events" USING btree ("created_at");
