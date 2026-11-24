import type { RecordedCall } from '../ai/types'
import type { DocumentStatus } from '../archive/types'

/**
 * One thing a processing run did, in the order it happened: something
 * processing did itself, the next call to a model, or a value it stored.
 */
export type ProcessingStep =
  | { kind: 'note'; title: string; detail: string }
  /** The calls of a run are in `ai_usage`; this marks where the next of them belongs. */
  | { kind: 'call' }
  /** `target` is the table and the column, e.g. `documents.title`. */
  | { kind: 'saved'; target: string; value: string }

/** One processing run of a document with everything the administrator may want to check. */
export interface ProcessingRun {
  runId: string
  at: string
  /** `null` for a run made before runs were recorded; only its calls are known. */
  outcome: 'ready' | 'failed' | null
  error: string | null
  /** The whole run; `null` when it was not measured. */
  durationMs: number | null
  steps: ProcessingStep[]
  calls: RecordedCall[]
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** Calls whose model has no known price; their cost is missing from the sum. */
  unpricedCalls: number
}

/** What the debug panel of the administration shows about one document. */
export interface DocumentDebug {
  documentId: string
  title: string
  originalFilename: string
  status: DocumentStatus
  /** What the archive holds about the document now, by table and column. */
  stored: { target: string; value: string }[]
  /** Newest first. */
  runs: ProcessingRun[]
}
