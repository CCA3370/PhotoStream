ALTER TABLE "viewer_feedback" ADD COLUMN "status" varchar(24) DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "viewer_feedback" ADD COLUMN "assigned_to_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "viewer_feedback" ADD COLUMN "resolution_note" text;
--> statement-breakpoint
ALTER TABLE "viewer_feedback" ADD COLUMN "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "viewer_feedback" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "viewer_feedback" ADD CONSTRAINT "viewer_feedback_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "viewer_feedback_status_id_idx" ON "viewer_feedback" USING btree ("status","id");
--> statement-breakpoint
CREATE INDEX "viewer_feedback_assignee_id_idx" ON "viewer_feedback" USING btree ("assigned_to_user_id","id");
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "reviewed_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
