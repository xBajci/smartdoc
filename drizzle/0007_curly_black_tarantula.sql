CREATE TABLE "processing_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"outcome" text NOT NULL,
	"error" text,
	"steps" jsonb NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processing_runs_document_idx" ON "processing_runs" USING btree ("document_id");