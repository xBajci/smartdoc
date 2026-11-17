-- Every question before sessions becomes a session of its own; which ones belonged together is not known.
ALTER TABLE "chat_traces" ADD COLUMN "session_id" text;--> statement-breakpoint
UPDATE "chat_traces" SET "session_id" = "id";--> statement-breakpoint
ALTER TABLE "chat_traces" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_traces" ADD COLUMN "history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_traces_session_idx" ON "chat_traces" USING btree ("session_id","created_at");
