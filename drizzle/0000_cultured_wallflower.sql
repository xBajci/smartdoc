CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"position" integer NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"original_filename" text NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"category_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_year" integer,
	"issued_year_source" text,
	"custom_description" text DEFAULT '' NOT NULL,
	"auto_description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"has_text" boolean,
	"error_reason" text,
	"page_count" integer,
	CONSTRAINT "documents_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip_hash" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_added_at_idx" ON "documents" USING btree ("added_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip_hash","attempted_at");