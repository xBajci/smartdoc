ALTER TABLE "optimizations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "optimizations" CASCADE;--> statement-breakpoint
ALTER TABLE "skill_versions" DROP CONSTRAINT IF EXISTS "skill_versions_optimization_id_optimizations_id_fk";
--> statement-breakpoint
ALTER TABLE "skill_versions" DROP COLUMN "optimization_id";