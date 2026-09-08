CREATE TYPE "public"."search_usage_method" AS ENUM('number', 'attributes', 'face');--> statement-breakpoint
CREATE TABLE "search_usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"album_id" uuid NOT NULL,
	"method" "search_usage_method" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "search_usage_events" ADD CONSTRAINT "search_usage_events_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_usage_events_album_created_idx" ON "search_usage_events" USING btree ("album_id","created_at");--> statement-breakpoint
CREATE INDEX "search_usage_events_method_created_idx" ON "search_usage_events" USING btree ("method","created_at");
