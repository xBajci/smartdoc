import type { DocumentFormat } from '../archive/types'

/** Tokens and money spent on calls to AI models. */
export interface UsageTotals {
  /** Runs that called a model: a processing run, a chat question, or one run of a command. */
  runs: number
  /** Calls to a model. A scanned PDF needs one per scanned page, plus one for the description. */
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** Calls whose model had no known price; their cost is missing from `costUsd`. */
  unpricedCalls: number
}

export interface UsageReport {
  total: UsageTotals
  /** `format` is `null` for calls that read no document, i.e. the optimizer. */
  groups: (UsageTotals & { model: string; format: DocumentFormat | null })[]
  /** The most recent runs, newest first. */
  runs: (UsageTotals & {
    runId: string
    documentTitle: string
    format: DocumentFormat | null
    at: string
    models: string[]
  })[]
}

/** What a model can be called for; `optimize` is only in older records. */
export const CALL_OPERATIONS = [
  'read-page',
  'read-mixed-page',
  'describe-image',
  'summarize',
  'categorize',
  'optimize',
  'embed',
  'chat',
  'weigh',
  'rerank',
  'glossary',
  'rewrite',
  'summary-chat',
] as const

export type CallOperation = (typeof CALL_OPERATIONS)[number]

/**
 * One call to a model: what was asked, what came back, what it used and what
 * it cost. Processing, the chat and the commands all record a call this way
 * (see `src/server/ai/calls.ts`).
 */
export interface ModelCall {
  operation: CallOperation
  /** As written in `.env`: provider:model. */
  model: string
  /** The place the call was made at; `null` for a call that is told no skills. In older records the key of one skill. */
  use: string | null
  /** Every skill the call was told, with the version of its text; `null` for a call told none, and in older records. */
  skills: { key: string; version: number }[] | null
  /** Page of a PDF the call read. */
  page: number | null
  /** The text sent to the model. A page or an image itself is only named. */
  input: string
  output: string
  /** Why the call failed; `null` when it went well. */
  error: string | null
  durationMs: number
  inputTokens: number
  outputTokens: number
  /** In US dollars; `null` when the price of the model is not known. */
  costUsd: number | null
}

/** A call as the records give it back. */
export interface RecordedCall extends ModelCall {
  id: number
  /** Only in older records, which name one skill: 0 is its starting wording. */
  skillVersion: number
}

export interface SkillView {
  key: string
  group: 'zpracovani' | 'chat'
  /** The system prompt of its group, or a skill attached to places. */
  kind: 'system' | 'skill'
  title: string
  purpose: string
  /** Places the skill is attached at; empty for a system prompt. */
  uses: string[]
  /** `false` for a skill the administrator added; only such a skill can be renamed, switched off or removed. */
  builtIn: boolean
  enabled: boolean
  /** 0 is the starting text from the code. */
  version: number
  /** A starting skill whose text or places the administrator changed; it can go back to the start. */
  changed: boolean
  /** The Markdown text in use. */
  content: string
}

export interface SkillsReport {
  skills: SkillView[]
  /** Every place a skill can be attached at. */
  uses: { use: string; group: 'zpracovani' | 'chat'; label: string }[]
}

/** What the administrator fills in for a skill of their own. */
export interface SkillInput {
  title: string
  group: 'zpracovani' | 'chat'
  uses: string[]
  content: string
}
