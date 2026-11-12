CREATE TYPE "public"."gmail_account_status" AS ENUM('active', 'needs_reconnect', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."gmail_message_outcome" AS ENUM('imported', 'duplicate', 'no_jobs', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "gmail_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text NOT NULL,
	"status" "gmail_account_status" DEFAULT 'active' NOT NULL,
	"label_id" text,
	"senders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"last_manual_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_account_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "gmail_account_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "gmail_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"google_message_id" text NOT NULL,
	"provider" text NOT NULL,
	"outcome" "gmail_message_outcome" NOT NULL,
	"jobs_found" integer DEFAULT 0 NOT NULL,
	"jobs_new" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone,
	CONSTRAINT "gmail_message_user_message_unique" UNIQUE("user_id","google_message_id")
);
--> statement-breakpoint
CREATE TABLE "gmail_message_job" (
	"message_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	CONSTRAINT "gmail_message_job_message_id_job_id_pk" PRIMARY KEY("message_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "gmail_oauth_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier_enc" text NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_oauth_state_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "gmail_account" ADD CONSTRAINT "gmail_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_message" ADD CONSTRAINT "gmail_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_message" ADD CONSTRAINT "gmail_message_account_id_gmail_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gmail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_message_job" ADD CONSTRAINT "gmail_message_job_message_id_gmail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."gmail_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_message_job" ADD CONSTRAINT "gmail_message_job_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_oauth_state" ADD CONSTRAINT "gmail_oauth_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gmail_account_status_idx" ON "gmail_account" USING btree ("status");--> statement-breakpoint
CREATE INDEX "gmail_message_account_processed_idx" ON "gmail_message" USING btree ("account_id","processed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "gmail_oauth_state_user_idx" ON "gmail_oauth_state" USING btree ("user_id");