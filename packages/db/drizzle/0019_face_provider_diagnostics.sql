CREATE TABLE "face_operation_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"source" varchar(40) NOT NULL,
	"operation" varchar(120) NOT NULL,
	"provider_code" varchar(200),
	"provider_message" text NOT NULL,
	"provider_request_id" varchar(256),
	"http_status" integer,
	"region" varchar(64),
	"endpoint" varchar(255),
	"project_name" varchar(128),
	"dataset_name" varchar(128),
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "face_operation_diagnostics" ADD CONSTRAINT "face_operation_diagnostics_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "face_operation_diagnostics_album_time_idx" ON "face_operation_diagnostics" USING btree ("album_id","occurred_at");
