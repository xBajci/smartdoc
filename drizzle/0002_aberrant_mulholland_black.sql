CREATE TABLE "ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"document_id" text,
	"document_title" text NOT NULL,
	"format" text NOT NULL,
	"operation" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage" USING btree ("created_at");