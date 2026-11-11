CREATE TABLE "site_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"site_key" text NOT NULL,
	"form_signature" text NOT NULL,
	"fingerprints" jsonb NOT NULL,
	"field_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_profile_user_site_form_unique" UNIQUE("user_id","site_key","form_signature")
);
--> statement-breakpoint
ALTER TABLE "site_profile" ADD CONSTRAINT "site_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_profile_user_last_used_idx" ON "site_profile" USING btree ("user_id","last_used_at");