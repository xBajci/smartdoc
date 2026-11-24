import { desc, sql } from 'drizzle-orm'
import type { UsageReport } from '../ai/types'
import { getDatabase } from '../db/client'
import { aiUsage } from '../db/schema'

const RECENT_RUNS = 50

const totals = {
  runs: sql<number>`count(distinct ${aiUsage.runId})::int`,
  calls: sql<number>`count(*)::int`,
  inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
  outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
  costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float8`,
  /** Calls whose model had no known price; their cost is missing from the sum. */
  unpricedCalls: sql<number>`(count(*) filter (where ${aiUsage.costUsd} is null))::int`,
}

/** What processing has cost: in total, by model and kind of file, and run by run. */
export async function usageReport(): Promise<UsageReport> {
  const database = getDatabase()
  const [[total], groups, runs] = await Promise.all([
    database.select(totals).from(aiUsage),
    database
      .select({ model: aiUsage.model, format: aiUsage.format, ...totals })
      .from(aiUsage)
      .groupBy(aiUsage.model, aiUsage.format)
      .orderBy(aiUsage.format, aiUsage.model),
    database
      .select({
        runId: aiUsage.runId,
        documentTitle: sql<string>`max(${aiUsage.documentTitle})`,
        format: sql<'pdf' | 'image' | null>`max(${aiUsage.format})`,
        at: sql<string>`to_char(max(${aiUsage.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
        models: sql<string[]>`array_agg(distinct ${aiUsage.model} order by ${aiUsage.model})`,
        ...totals,
      })
      .from(aiUsage)
      .groupBy(aiUsage.runId)
      .orderBy(desc(sql`max(${aiUsage.createdAt})`))
      .limit(RECENT_RUNS),
  ])
  if (total === undefined) throw new Error('Totals query returned no row.')
  return { total, groups, runs }
}
