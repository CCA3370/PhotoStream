DROP INDEX "users_creation_idempotency_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creation_actor_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "users_creation_actor_idempotency_unique" ON "users" USING btree ("creation_actor_id","creation_idempotency_key") WHERE "users"."creation_actor_id" is not null and "users"."creation_idempotency_key" is not null;