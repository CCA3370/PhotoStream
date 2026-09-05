CREATE TABLE "featured_media" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"featured_by" uuid NOT NULL,
	"featured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "featured_media" ADD CONSTRAINT "featured_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "featured_media" ADD CONSTRAINT "featured_media_featured_by_users_id_fk" FOREIGN KEY ("featured_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
