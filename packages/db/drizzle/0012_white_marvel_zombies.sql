CREATE TABLE "sensitive_verdict" (
	"key" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
