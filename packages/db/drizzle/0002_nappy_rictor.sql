CREATE TABLE "upload_parts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"part_number" integer NOT NULL,
	"expected_bytes" bigint NOT NULL,
	"etag" varchar(128),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_variant_id_media_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."media_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upload_parts_variant_number_unique" ON "upload_parts" USING btree ("variant_id","part_number");--> statement-breakpoint
CREATE INDEX "upload_parts_variant_completed_idx" ON "upload_parts" USING btree ("variant_id","completed_at");