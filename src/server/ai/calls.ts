import type { ModelCall } from '../../ai/types'
import { getDatabase, type Database } from '../../db/client'
import { aiUsage } from '../../db/schema'
import { costOfCall } from './prices'

/**
 * The record of a call to a model. This is the one place that knows what a
 * call used, what it cost, what is kept of one that failed, and how the calls
 * of a run reach `ai_usage`. Whoever calls a model says only what happened.
 */
export type { ModelCall }
/** Takes a call as it ends, so the calls of a run are kept even when the run fails later. */
export type RecordCall = (call: ModelCall) => void

/** Tokens every stand-in model of the test suite reports for a call, so costs in tests are fixed. */
export const FAKE_USAGE = { inputTokens: 1000, outputTokens: 100 }

/** How much of a sent text is kept in the record of a call. */
const RECORDED_INPUT_CHARACTERS = 16_000

/** The tokens of a call as its model reports them; the AI SDK gives this shape. */
export interface ReportedUsage {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  /** Absent for a model that says nothing of the provider's cache. */
  inputTokenDetails?:
    | { cacheReadTokens?: number | undefined; cacheWriteTokens?: number | undefined }
    | undefined
}

/** What a call used and what it cost. */
export interface Spent {
  /** All of the input, the part read from the provider's cache included. */
  inputTokens: number
  /** Input read from the provider's cache; absent when the model does not say. */
  cachedInputTokens?: number
  outputTokens: number
  /** In US dollars; `null` when the price of the model is not known. */
  costUsd: number | null
}

/** What a call used and cost, from what its model reported. Input from the cache has a price of its own. */
export function spent(model: string, usage: ReportedUsage): Spent {
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const details = usage.inputTokenDetails
  if (details === undefined) {
    return { inputTokens, outputTokens, costUsd: costOfCall(model, inputTokens, outputTokens) }
  }
  const cached = { read: details.cacheReadTokens ?? 0, written: details.cacheWriteTokens ?? 0 }
  return {
    inputTokens,
    cachedInputTokens: cached.read,
    outputTokens,
    costUsd: costOfCall(model, inputTokens, outputTokens, cached),
  }
}

/** A call that failed used nothing that is known: no tokens, and no cost when the model has a price. */
export function unspent(model: string): Spent {
  return spent(model, {})
}

/** Why something failed, as the records keep it. */
export function reasonOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

/** What is known of a call before it is made. */
export type CallHead = Pick<ModelCall, 'operation' | 'use' | 'skills' | 'page' | 'input'>

/** What a call that went well came to. */
export interface CallResult<T> {
  /** What the caller gets. */
  value: T
  /** What the model gave back, as the record shows it. */
  output: string
  usage: ReportedUsage
  /** The model that answered, when only the answer says which; otherwise the one the call was made with. */
  model?: string
}

/** Runs one call and records it whether it ends well or not, then passes the outcome on. */
export async function recorded<T>(
  record: RecordCall,
  model: string,
  head: CallHead,
  work: () => Promise<CallResult<T>>,
): Promise<T> {
  const started = Date.now()
  const call = { ...head, input: head.input.slice(0, RECORDED_INPUT_CHARACTERS) }
  try {
    const { value, output, usage, model: answered = model } = await work()
    const { inputTokens, outputTokens, costUsd } = spent(answered, usage)
    record({
      ...call,
      model: answered,
      output,
      error: null,
      durationMs: Date.now() - started,
      inputTokens,
      outputTokens,
      costUsd,
    })
    return value
  } catch (error) {
    record({
      ...call,
      model,
      output: '',
      error: reasonOf(error),
      durationMs: Date.now() - started,
      ...unspent(model),
    })
    throw error
  }
}

/** The cost of several calls together; `null` when no call had a known price. */
export function costOfCalls(calls: readonly Pick<ModelCall, 'costUsd'>[]): number | null {
  const priced = calls.filter((call) => call.costUsd !== null)
  return priced.length === 0 ? null : priced.reduce((sum, call) => sum + (call.costUsd ?? 0), 0)
}

/** What the calls of one run belong to. */
export interface CallRun {
  /** All calls of one run share this id; a chat question uses the id of its trace. */
  runId: string
  /** The document the run read; `null` when it read none, or the document is gone. */
  documentId: string | null
  /** Name of the document at the time, or what the run was, e.g. "Chat: …". */
  title: string
  format: 'pdf' | 'image' | null
}

/** Writes the calls of one run to the records of AI calls, in the order they were made. */
export async function storeCalls(
  run: CallRun,
  calls: readonly ModelCall[],
  writer: Pick<Database, 'insert'> = getDatabase(),
): Promise<void> {
  if (calls.length === 0) return
  await writer.insert(aiUsage).values(
    calls.map((call) => ({
      runId: run.runId,
      documentId: run.documentId,
      documentTitle: run.title,
      format: run.format,
      ...call,
    })),
  )
}
