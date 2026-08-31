CREATE TYPE "public"."face_album_job_kind" AS ENUM('provision_dataset', 'cluster', 'delete_dataset');--> statement-breakpoint
CREATE TYPE "public"."face_consent_declaration" AS ENUM('self', 'guardian_or_authorized');--> statement-breakpoint
CREATE TYPE "public"."face_consent_result" AS ENUM('created', 'completed_with_results', 'completed_empty', 'reference_rejected', 'cancelled', 'expired', 'provider_failed', 'cleanup_failed');--> statement-breakpoint
CREATE TYPE "public"."face_event_processing_result" AS ENUM('processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."face_index_state" AS ENUM('disabled', 'provisioning', 'indexing', 'ready', 'degraded', 'deleting', 'failed');--> statement-breakpoint
CREATE TYPE "public"."face_job_status" AS ENUM('pending', 'processing', 'failed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."face_media_index_status" AS ENUM('pending', 'indexing', 'indexed', 'deleting', 'excluded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."face_search_status" AS ENUM('awaiting_upload', 'processing', 'partial', 'completed', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "album_face_indexes" (
	"album_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"notice_version" varchar(80),
	"threshold_version" varchar(80) NOT NULL,
	"participant_consent_records_confirmed" boolean DEFAULT false NOT NULL,
	"guardian_consent_requirements_confirmed" boolean DEFAULT false NOT NULL,
	"impact_assessment_completed" boolean DEFAULT false NOT NULL,
	"provider_resources_validated" boolean DEFAULT false NOT NULL,
	"evaluation_gate_passed" boolean DEFAULT false NOT NULL,
	"billing_alerts_configured" boolean DEFAULT false NOT NULL,
	"indexed_faces_authorized" boolean DEFAULT false NOT NULL,
	"authorization_confirmed_at" timestamp with time zone,
	"index_state" "face_index_state" DEFAULT 'disabled' NOT NULL,
	"dataset_name" varchar(128),
	"retention_days" integer DEFAULT 30 NOT NULL,
	"last_indexed_at" timestamp with time zone,
	"last_clustered_at" timestamp with time zone,
	"deletion_due_at" timestamp with time zone,
	"last_error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "face_album_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"kind" "face_album_job_kind" NOT NULL,
	"status" "face_job_status" DEFAULT 'pending' NOT NULL,
	"provider_task_id" varchar(256),
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" varchar(100),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "face_consent_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"notice_version" varchar(80) NOT NULL,
	"declaration" "face_consent_declaration" NOT NULL,
	"result_category" "face_consent_result" DEFAULT 'created' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "face_integration_events" (
	"event_id" varchar(256) PRIMARY KEY NOT NULL,
	"provider_task_id" varchar(256) NOT NULL,
	"processing_result" "face_event_processing_result" NOT NULL,
	"error_code" varchar(100),
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "face_search_candidates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"search_intent_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "face_search_intents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"visitor_session_digest" varchar(64) NOT NULL,
	"ip_daily_digest" varchar(64) NOT NULL,
	"status" "face_search_status" DEFAULT 'awaiting_upload' NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"expected_bytes" integer NOT NULL,
	"object_etag" varchar(128),
	"notice_version" varchar(80) NOT NULL,
	"declaration" "face_consent_declaration" NOT NULL,
	"consent_receipt_id" uuid,
	"provider_task_id" varchar(256),
	"reference_expires_at" timestamp with time zone NOT NULL,
	"result_expires_at" timestamp with time zone NOT NULL,
	"reference_deleted_at" timestamp with time zone,
	"initial_search_completed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" varchar(100),
	"cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"cleanup_next_attempt_at" timestamp with time zone,
	"cleanup_last_error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_face_index_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"status" "face_media_index_status" DEFAULT 'pending' NOT NULL,
	"provider_task_id" varchar(256),
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" varchar(100),
	"deletion_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "album_face_indexes" ADD CONSTRAINT "album_face_indexes_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_album_jobs" ADD CONSTRAINT "face_album_jobs_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_consent_receipts" ADD CONSTRAINT "face_consent_receipts_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_search_candidates" ADD CONSTRAINT "face_search_candidates_search_intent_id_face_search_intents_id_fk" FOREIGN KEY ("search_intent_id") REFERENCES "public"."face_search_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_search_candidates" ADD CONSTRAINT "face_search_candidates_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_search_intents" ADD CONSTRAINT "face_search_intents_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_search_intents" ADD CONSTRAINT "face_search_intents_consent_receipt_id_face_consent_receipts_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "public"."face_consent_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_face_index_tasks" ADD CONSTRAINT "media_face_index_tasks_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_face_index_tasks" ADD CONSTRAINT "media_face_index_tasks_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "album_face_indexes_dataset_name_unique" ON "album_face_indexes" USING btree ("dataset_name") WHERE "album_face_indexes"."dataset_name" is not null;--> statement-breakpoint
CREATE INDEX "album_face_indexes_state_due_idx" ON "album_face_indexes" USING btree ("index_state","deletion_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "face_album_jobs_active_kind_unique" ON "face_album_jobs" USING btree ("album_id","kind") WHERE "face_album_jobs"."status" in ('pending', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "face_album_jobs_provider_task_unique" ON "face_album_jobs" USING btree ("provider_task_id") WHERE "face_album_jobs"."provider_task_id" is not null;--> statement-breakpoint
CREATE INDEX "face_album_jobs_poll_idx" ON "face_album_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "face_consent_receipts_album_occurred_idx" ON "face_consent_receipts" USING btree ("album_id","occurred_at");--> statement-breakpoint
CREATE INDEX "face_integration_events_task_processed_idx" ON "face_integration_events" USING btree ("provider_task_id","processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "face_search_candidates_intent_media_unique" ON "face_search_candidates" USING btree ("search_intent_id","media_id");--> statement-breakpoint
CREATE INDEX "face_search_candidates_expiry_idx" ON "face_search_candidates" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "face_search_intents_object_key_unique" ON "face_search_intents" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "face_search_intents_provider_task_unique" ON "face_search_intents" USING btree ("provider_task_id") WHERE "face_search_intents"."provider_task_id" is not null;--> statement-breakpoint
CREATE INDEX "face_search_intents_session_rate_idx" ON "face_search_intents" USING btree ("visitor_session_digest","created_at");--> statement-breakpoint
CREATE INDEX "face_search_intents_ip_rate_idx" ON "face_search_intents" USING btree ("ip_daily_digest","created_at");--> statement-breakpoint
CREATE INDEX "face_search_intents_expiry_idx" ON "face_search_intents" USING btree ("status","result_expires_at");--> statement-breakpoint
CREATE INDEX "face_search_intents_cleanup_idx" ON "face_search_intents" USING btree ("reference_deleted_at","cleanup_next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_face_index_tasks_media_unique" ON "media_face_index_tasks" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_face_index_tasks_provider_task_unique" ON "media_face_index_tasks" USING btree ("provider_task_id") WHERE "media_face_index_tasks"."provider_task_id" is not null;--> statement-breakpoint
CREATE INDEX "media_face_index_tasks_album_status_idx" ON "media_face_index_tasks" USING btree ("album_id","status","id");--> statement-breakpoint
CREATE INDEX "media_face_index_tasks_poll_idx" ON "media_face_index_tasks" USING btree ("status","next_attempt_at");