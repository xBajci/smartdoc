CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_textsearch;--> statement-breakpoint
CREATE TABLE "chat_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"error" text,
	"scope" text NOT NULL,
	"model" text NOT NULL,
	"steps" jsonb NOT NULL,
	"setup" jsonb NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"asker_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"page" integer,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"indexed" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_traces_created_at_idx" ON "chat_traces" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "document_chunks_document_idx" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "document_chunks_bm25_idx" ON "document_chunks" USING bm25 ("indexed") WITH (text_config='public.cs_simple');
