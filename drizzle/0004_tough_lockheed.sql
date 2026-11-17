ALTER TABLE "documents" ADD COLUMN "category_source" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
-- A document that is already in a category of its own was put there by somebody.
UPDATE "documents" SET "category_source" = 'manual' WHERE "category_id" NOT IN (SELECT "id" FROM "categories" WHERE "is_fallback");
