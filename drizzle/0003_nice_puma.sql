CREATE TABLE "optimizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"assessment" text NOT NULL,
	"calls_reviewed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"skill_key" text NOT NULL,
	"version" integer,
	"parts" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"status" text NOT NULL,
	"optimization_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ALTER COLUMN "format" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "skill_key" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "skill_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "page" integer;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "input" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "output" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "duration_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_optimization_id_optimizations_id_fk" FOREIGN KEY ("optimization_id") REFERENCES "public"."optimizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_versions_key_idx" ON "skill_versions" USING btree ("skill_key","status");