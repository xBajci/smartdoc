import { asc, count, desc, eq, sql } from 'drizzle-orm'
import type { DocumentDebug, ProcessingRun, SessionCall } from '../archive/types'
import { cs, fill } from '../copy/cs'
import { getDatabase } from '../db/client'
import { aiUsage, categories, documentChunks, documents, processingRuns } from '../db/schema'

/** Runs of one document the debug panel shows; older ones are left out. */
const SHOWN_RUNS = 10
/** How much of a long stored text is sent to the panel. */
const SHOWN_CHARACTERS = 4000

const at = (column: typeof aiUsage.createdAt | typeof processingRuns.createdAt) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

function shown(text: string): string {
  return text.length > SHOWN_CHARACTERS
    ? `${text.slice(0, SHOWN_CHARACTERS)}…\n(${fill(cs.trace.characters, { count: text.length })})`
    : text
}

/**
 * Everything the administrator may want to check about the processing of one
 * document: what the archive holds about it now and its runs, step by step.
 * `null` when the document is not there.
 */
export async function documentDebug(id: string): Promise<DocumentDebug | null> {
  const database = getDatabase()
  const [[row], [pieces], traces, calls] = await Promise.all([
    database
      .select({ document: documents, category: categories.name })
      .from(documents)
      .leftJoin(categories, eq(categories.id, documents.categoryId))
      .where(eq(documents.id, id)),
    database
      .select({
        total: count(),
        embedded: count(documentChunks.embedding),
        model: sql<string | null>`max(${documentChunks.embeddingModel})`,
      })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, id)),
    database
      .select({
        runId: processingRuns.id,
        at: at(processingRuns.createdAt),
        outcome: processingRuns.outcome,
        error: processingRuns.error,
        durationMs: processingRuns.durationMs,
        steps: processingRuns.steps,
      })
      .from(processingRuns)
      .where(eq(processingRuns.documentId, id))
      .orderBy(desc(processingRuns.createdAt)),
    database
      .select({
        runId: aiUsage.runId,
        at: at(aiUsage.createdAt),
        id: aiUsage.id,
        operation: aiUsage.operation,
        model: aiUsage.model,
        skillKey: aiUsage.skillKey,
        skillVersion: aiUsage.skillVersion,
        skills: aiUsage.skills,
        page: aiUsage.page,
        input: aiUsage.input,
        output: aiUsage.output,
        error: aiUsage.error,
        durationMs: aiUsage.durationMs,
        inputTokens: aiUsage.inputTokens,
        outputTokens: aiUsage.outputTokens,
        costUsd: aiUsage.costUsd,
      })
      .from(aiUsage)
      .where(eq(aiUsage.documentId, id))
      .orderBy(asc(aiUsage.id)),
  ])
  if (row === undefined) return null
  const { document, category } = row

  const callsByRun = new Map<string, { at: string; calls: SessionCall[] }>()
  for (const { runId, at: madeAt, ...call } of calls) {
    const run = callsByRun.get(runId) ?? { at: madeAt, calls: [] }
    run.calls.push(call)
    callsByRun.set(runId, run)
  }

  const run = (
    head: Pick<ProcessingRun, 'runId' | 'at' | 'outcome' | 'error' | 'durationMs' | 'steps'>,
    runCalls: SessionCall[],
  ): ProcessingRun => ({
    ...head,
    calls: runCalls,
    inputTokens: runCalls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: runCalls.reduce((sum, call) => sum + call.outputTokens, 0),
    costUsd: runCalls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0),
    unpricedCalls: runCalls.filter((call) => call.costUsd === null).length,
  })

  const traced = new Set(traces.map((trace) => trace.runId))
  const runs = [
    ...traces.map((trace) => run(trace, callsByRun.get(trace.runId)?.calls ?? [])),
    // Runs from before the steps were recorded: only their calls are known.
    ...[...callsByRun]
      .filter(([runId]) => !traced.has(runId))
      .map(([runId, old]) =>
        run(
          {
            runId,
            at: old.at,
            outcome: null,
            error: null,
            durationMs: null,
            steps: old.calls.map(() => ({ kind: 'call' as const })),
          },
          old.calls,
        ),
      ),
  ]
    .sort((first, second) => second.at.localeCompare(first.at))
    .slice(0, SHOWN_RUNS)

  const value = (stored: string | number | boolean | null) =>
    stored === null ? 'null' : shown(String(stored))
  const stored: [string, string | number | boolean | null][] = [
    ['documents.id', document.id],
    ['documents.status', document.status],
    ['documents.error_reason', document.errorReason],
    ['documents.title', document.title],
    ['documents.title_source', document.titleSource],
    ['documents.original_filename', document.originalFilename],
    ['documents.mime_type', document.mimeType],
    ['documents.size_bytes', document.sizeBytes],
    ['documents.sha256', document.sha256],
    ['documents.storage_key', document.storageKey],
    ['documents.thumbnail_key', document.thumbnailKey],
    ['documents.category_id', `${document.categoryId} (${category ?? '?'})`],
    ['documents.category_source', document.categorySource],
    ['documents.issued_year', document.issuedYear],
    ['documents.issued_on', document.issuedOn],
    ['documents.issued_year_source', document.issuedYearSource],
    ['documents.page_count', document.pageCount],
    ['documents.has_text', document.hasText],
    ['documents.custom_description', document.customDescription],
    ['documents.short_description', document.shortDescription],
    ['documents.auto_description', document.autoDescription],
    ['document_chunks', fill(cs.trace.rows, { count: pieces?.total ?? 0 })],
    ['document_chunks.embedding', fill(cs.trace.rows, { count: pieces?.embedded ?? 0 })],
    ['document_chunks.embedding_model', pieces?.model ?? null],
  ]

  return {
    documentId: document.id,
    title: document.title,
    originalFilename: document.originalFilename,
    status: document.status,
    stored: stored.map(([target, storedValue]) => ({ target, value: value(storedValue) })),
    runs,
  }
}
