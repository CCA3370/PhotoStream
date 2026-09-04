CREATE TABLE "media_likes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"media_id" uuid NOT NULL,
	"visitor_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_likes" ADD CONSTRAINT "media_likes_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "media_likes_media_visitor_unique" ON "media_likes" USING btree ("media_id","visitor_digest");
--> statement-breakpoint
CREATE INDEX "media_likes_media_idx" ON "media_likes" USING btree ("media_id");
