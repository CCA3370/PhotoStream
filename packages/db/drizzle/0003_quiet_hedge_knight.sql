CREATE TYPE "public"."analytics_event_type" AS ENUM('open', 'session', 'download');--> statement-breakpoint
CREATE TYPE "public"."deletion_object_status" AS ENUM('pending', 'deleted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."deletion_task_status" AS ENUM('pending', 'processing', 'failed', 'completed');--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"album_id" uuid NOT NULL,
	"day" date NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"unique_visitors" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"album_id" uuid NOT NULL,
	"day" date NOT NULL,
	"event_type" "analytics_event_type" NOT NULL,
	"visitor_digest" varchar(64) NOT NULL,
	"media_id" uuid,
	"variant_kind" "variant_kind",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_task_objects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"variant_kind" "variant_kind" NOT NULL,
	"object_key" varchar(512),
	"status" "deletion_object_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(100),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deletion_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"media_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" "deletion_task_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(100),
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_batch_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "privacy_notice" varchar(2000) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "complaint_contact" varchar(300) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_task_objects" ADD CONSTRAINT "deletion_task_objects_task_id_deletion_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."deletion_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_tasks" ADD CONSTRAINT "deletion_tasks_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_tasks" ADD CONSTRAINT "deletion_tasks_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_batch_requests" ADD CONSTRAINT "media_batch_requests_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_album_day_unique" ON "analytics_daily" USING btree ("album_id","day");--> statement-breakpoint
CREATE INDEX "analytics_events_album_day_idx" ON "analytics_events" USING btree ("album_id","day");--> statement-breakpoint
CREATE INDEX "analytics_events_retention_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_task_objects_task_variant_unique" ON "deletion_task_objects" USING btree ("task_id","variant_kind");--> statement-breakpoint
CREATE INDEX "deletion_task_objects_status_idx" ON "deletion_task_objects" USING btree ("task_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_tasks_media_unique" ON "deletion_tasks" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "deletion_tasks_poll_idx" ON "deletion_tasks" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_batch_actor_idempotency_unique" ON "media_batch_requests" USING btree ("actor_user_id","idempotency_key");