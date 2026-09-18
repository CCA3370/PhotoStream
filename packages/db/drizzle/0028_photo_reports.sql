ALTER TABLE "viewer_feedback" ADD COLUMN "media_id" uuid;
--> statement-breakpoint
ALTER TABLE "viewer_feedback" ADD COLUMN "report_reason" varchar(32);
--> statement-breakpoint
ALTER TABLE "viewer_feedback" ADD CONSTRAINT "viewer_feedback_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "viewer_feedback_media_id_idx" ON "viewer_feedback" USING btree ("media_id","id");
