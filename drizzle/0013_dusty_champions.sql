ALTER TABLE "chat_traces" ADD COLUMN "helpful" boolean;--> statement-breakpoint
ALTER TABLE "chat_traces" ADD COLUMN "rated_at" timestamp with time zone;