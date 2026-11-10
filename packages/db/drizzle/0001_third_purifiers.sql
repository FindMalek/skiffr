CREATE TYPE "public"."answer_source" AS ENUM('manual', 'autofill', 'ai', 'import');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('applied', 'responded', 'interview', 'offer', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'applied', 'skipped');--> statement-breakpoint
CREATE TABLE "answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"normalized_label" text NOT NULL,
	"raw_label" text NOT NULL,
	"value" text NOT NULL,
	"source" "answer_source" DEFAULT 'manual' NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"times_corrected" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_user_label_unique" UNIQUE("user_id","normalized_label")
);
--> statement-breakpoint
CREATE TABLE "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"ats" text NOT NULL,
	"resume_id" text,
	"match_score" integer,
	"status" "application_status" DEFAULT 'applied' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"interview_at" timestamp with time zone,
	"offer_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"canonical_id" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"source" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_user_canonical_unique" UNIQUE("user_id","canonical_id")
);
--> statement-breakpoint
CREATE TABLE "job_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_source_user_url_unique" UNIQUE("user_id","url")
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_source" ADD CONSTRAINT "job_source_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_user_status_idx" ON "application" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "job_user_status_queued_idx" ON "job" USING btree ("user_id","status","queued_at" DESC NULLS LAST);