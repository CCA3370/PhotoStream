CREATE TABLE "album_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"content" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_notifications_time_window_check" CHECK ("album_notifications"."ends_at" > "album_notifications"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "album_notifications" ADD CONSTRAINT "album_notifications_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "album_notifications" ADD CONSTRAINT "album_notifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "album_notifications_album_time_idx" ON "album_notifications" USING btree ("album_id","starts_at","ends_at");
