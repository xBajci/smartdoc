import { randomUUID } from 'node:crypto'
import { and, eq, lt, ne, or, sql } from 'drizzle-orm'
import type { ModelCall } from '../ai/types'
import { getDatabase } from '../db/client'
import {
  categories,
  documents,
  processingRuns,
  type CategoryRow,
  type DocumentRow,
} from '../db/schema'
import type { ProcessingStep } from '../processing/types'
import { storeCalls } from './ai/calls'
import { writeChunks, type ChunkRow } from './chat/index-service'

/** A run that has not finished in this time is taken for dead and may be started again. */
const STALE_AFTER_MINUTES = 10

/** What is kept of one processing run, besides its calls to models. */
export interface RunRecord {
  outcome: 'ready' | 'failed'
  /** Why the run failed; `null` when it went well. */
  error: string | null
  steps: ProcessingStep[]
  durationMs: number
}

/**
 * What a processing run reads and writes of the archive. The application
 * keeps it in Postgres; the tests of a run keep it in memory.
 */
export interface ProcessingStore {
  /**
   * Takes the document for processing and marks it as being processed. Only
   * one caller gets it: a document that is being processed is given again
   * only when its run went stale.
   */
  claim(id: string): Promise<DocumentRow | undefined>
  /** The document as it is now; `undefined` when it was removed meanwhile. */
  current(id: string): Promise<DocumentRow | undefined>
  categories(): Promise<CategoryRow[]>
  /**
   * Writes what a run found. The document and its pieces change together, so
   * the chat never reads half of each.
   */
  finish(
    id: string,
    values: Partial<typeof documents.$inferInsert>,
    chunks: readonly ChunkRow[],
  ): Promise<void>
  /** Marks the document as failed, with a reason the administrator can read. */
  fail(id: string, reason: string): Promise<void>
  /** Keeps the record of a run and the calls to models it made, also of a run that failed. */
  keepRun(document: DocumentRow, run: RunRecord, calls: readonly ModelCall[]): Promise<void>
}

/** Writes the calls of one run of a document to the records of AI calls, under `runId`. */
export async function keepCalls(document: DocumentRow, calls: readonly ModelCall[], runId: string) {
  if (calls.length === 0) return
  // The document may have been removed while it was being read.
  const [current] = await getDatabase()
    .select({ title: documents.title })
    .from(documents)
    .where(eq(documents.id, document.id))
  await storeCalls(
    {
      runId,
      documentId: current === undefined ? null : document.id,
      title: current?.title ?? document.title,
      format: document.format,
    },
    calls,
  )
}

/** The archive as the application keeps it: `documents`, `document_chunks`, `processing_runs` and `ai_usage`. */
export const postgresStore: ProcessingStore = {
  async claim(id) {
    const [row] = await getDatabase()
      .update(documents)
      .set({ status: 'processing', errorReason: null, processingStartedAt: new Date() })
      .where(
        and(
          eq(documents.id, id),
          or(
            ne(documents.status, 'processing'),
            sql`${documents.processingStartedAt} is null`,
            lt(
              documents.processingStartedAt,
              sql`now() - make_interval(mins => ${STALE_AFTER_MINUTES})`,
            ),
          ),
        ),
      )
      .returning()
    return row
  },

  async current(id) {
    const [row] = await getDatabase().select().from(documents).where(eq(documents.id, id))
    return row
  },

  categories() {
    return getDatabase().select().from(categories)
  },

  async finish(id, values, chunks) {
    await getDatabase().transaction(async (transaction) => {
      await transaction.update(documents).set(values).where(eq(documents.id, id))
      await writeChunks(transaction, id, chunks)
    })
  },

  async fail(id, reason) {
    await getDatabase()
      .update(documents)
      .set({ status: 'failed', errorReason: reason })
      .where(eq(documents.id, id))
  },

  async keepRun(document, run, calls) {
    const runId = randomUUID()
    // Calls made before a failure were paid for too.
    await keepCalls(document, calls, runId).catch((error: unknown) => {
      console.error(`Usage of ${document.id} was not recorded:`, error)
    })
    // The document may have been removed while it was being read; then there is nothing to hang the run on.
    await getDatabase()
      .insert(processingRuns)
      .values({ id: runId, documentId: document.id, ...run })
      .catch(() => {})
  },
}
