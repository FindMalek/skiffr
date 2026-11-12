CREATE TYPE "public"."job_source_kind" AS ENUM('auto', 'greenhouse', 'lever', 'ashby', 'workable', 'feed', 'html');--> statement-breakpoint
CREATE TYPE "public"."job_source_status" AS ENUM('pending', 'ok', 'error');--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "kind" "job_source_kind" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "status" "job_source_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "last_manual_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "etag" text;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "last_modified" text;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "last_found" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "last_added" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "seen_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "job_source_due_idx" ON "job_source" USING btree ("enabled","next_attempt_at");