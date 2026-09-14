CREATE TABLE "album_data_saver_settings" (
  "album_id" uuid PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "album_data_saver_settings" ADD CONSTRAINT "album_data_saver_settings_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
