CREATE TYPE "public"."upload_cleanup_status" AS ENUM('not_needed', 'pending', 'processing', 'failed', 'completed');--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "cleanup_status" "upload_cleanup_status" DEFAULT 'not_needed' NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "cleanup_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "cleanup_last_error_code" varchar(100);--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "cleanup_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "cleanup_completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "upload_intents_cleanup_idx" ON "upload_intents" USING btree ("cleanup_status","cleanup_next_attempt_at");