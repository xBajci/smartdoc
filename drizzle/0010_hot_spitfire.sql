CREATE TABLE "custom_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"group" text NOT NULL,
	"uses" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "skills" jsonb;