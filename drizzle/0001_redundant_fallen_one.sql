ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "title_source" text DEFAULT 'filename' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "short_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_started_at" timestamp with time zone;