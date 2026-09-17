CREATE TABLE "viewer_feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"album_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"message" text NOT NULL,
	"page_path" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "viewer_feedback" ADD CONSTRAINT "viewer_feedback_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "viewer_feedback_album_id_idx" ON "viewer_feedback" USING btree ("album_id","id");
--> statement-breakpoint
CREATE INDEX "viewer_feedback_created_idx" ON "viewer_feedback" USING btree ("id");
