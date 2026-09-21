ALTER TABLE "media" ADD COLUMN "source_sha256" varchar(64);
--> statement-breakpoint
CREATE INDEX "media_album_source_sha256_idx" ON "media" USING btree ("album_id","source_sha256");
