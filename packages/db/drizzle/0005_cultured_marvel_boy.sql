CREATE TYPE "public"."answer_status" AS ENUM('learned', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."field_event_outcome" AS ENUM('accepted', 'corrected', 'cleared');--> statement-breakpoint
CREATE TYPE "public"."field_event_source" AS ENUM('profile', 'answer', 'ai', 'site');--> statement-breakpoint
CREATE TABLE "field_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"application_id" uuid,
	"site_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"normalized_label" text NOT NULL,
	"raw_label" text NOT NULL,
	"field_type" text DEFAULT '' NOT NULL,
	"filled_value" text NOT NULL,
	"final_value" text NOT NULL,
	"source" "field_event_source" NOT NULL,
	"outcome" "field_event_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_batch" (
	"user_id" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_batch_user_id_batch_id_pk" PRIMARY KEY("user_id","batch_id")
);
--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN "times_cleared" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN "status" "answer_status" DEFAULT 'learned' NOT NULL;--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN "last_corrected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "field_event" ADD CONSTRAINT "field_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_event" ADD CONSTRAINT "field_event_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_batch" ADD CONSTRAINT "record_batch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_event_user_label_idx" ON "field_event" USING btree ("user_id","normalized_label","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "field_event_user_created_idx" ON "field_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "field_event_application_idx" ON "field_event" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "answer_user_fingerprint_idx" ON "answer" USING btree ("user_id","fingerprint");