CREATE TABLE "operation_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_scope" varchar(128) NOT NULL,
	"operation" varchar(120) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operation_requests_scope_operation_key_unique" ON "operation_requests" USING btree ("actor_scope","operation","idempotency_key");