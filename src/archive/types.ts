export type DocumentFormat = 'pdf' | 'image'

/** `uploading` exists only in the administrator's browser; the rest are the database states. */
export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed'

export interface Category {
  id: string
  name: string
  /** What belongs here; helps the decision model pick the category. Empty for a visitor. */
  description: string
  /** Colour of the index tab that marks the category in every view. */
  color: string
  /** The fallback category receives documents of a removed category and cannot be removed. */
  isFallback: boolean
  /** How many documents the reader may see in the category: all for the administrator, public ones otherwise. */
  documentCount: number
}

/** What the administrator writes about a category; the same for a new one and for a change. */
export interface CategoryInput {
  name: string
  description: string
  /** One of `CATEGORY_COLORS`, or the colour the category already has. */
  color: string
}

export interface ArchiveDocument {
  id: string
  originalFilename: string
  title: string
  /** Where the name came from: the file name, processing, or the administrator. */
  titleSource: 'filename' | 'auto' | 'manual'
  format: DocumentFormat
  mimeType: string
  sizeBytes: number
  /** Address of the original inside this application. */
  fileUrl: string
  /** Address of the small copy of an image; `null` for a PDF or when none exists. */
  thumbnailUrl: string | null
  /** Content fingerprint used to recognise a duplicate upload. */
  sha256: string
  categoryId: string
  /** ISO date of insertion into the archive — not the date the document was issued. */
  addedAt: string
  issuedYear: number | null
  /** The day the document is dated, `YYYY-MM-DD`; `null` when only the year, or nothing, is known. */
  issuedOn: string | null
  /** Who supplied `issuedYear` and `issuedOn`; a manual value is never overwritten by processing. */
  issuedYearSource: 'auto' | 'manual' | null
  customDescription: string
  /** One or two sentences written by processing. */
  shortDescription: string
  status: DocumentStatus
  /** `null` until processing has looked for text in the document. */
  hasText: boolean | null
  errorReason: string | null
  pageCount: number | null
  /** What reading this document with AI has cost so far. Only the administrator receives it. */
  usage: DocumentUsage | null
}

export interface DocumentUsage {
  /** Every model that worked on the document, as provider:model. */
  models: string[]
  /** Sum over all processing runs, in US dollars; `null` when no call had a known price. */
  costUsd: number | null
}

export type ViewMode = 'seznam' | 'nahled'
/**
 * Best match, newest, oldest, by name, by category; `-z` is the same column
 * the other way round. Best match needs searched words and is the order a search starts with.
 */
export type SortOrder =
  | 'shoda'
  /** By the date of the document itself, newest first; `vydane-z` is oldest first. */
  | 'vydane'
  | 'vydane-z'
  /** By the day the document was added to the archive. */
  | 'nove'
  | 'stare'
  | 'nazev'
  | 'nazev-z'
  | 'kategorie'
  | 'kategorie-z'
export type YearFilter = number | 'neznamy'
/** Kind of file a list is narrowed to. */
export type FileKindFilter = 'pdf' | 'obrazek'

export interface LibrarySearch {
  q?: string
  kategorie?: string
  rok?: YearFilter
  typ?: FileKindFilter
  zobrazeni?: ViewMode
  razeni?: SortOrder
  /** How many documents the list shows; "Zobrazit další" raises it. */
  pocet?: number
  doc?: string
  /** Page inside the open PDF. */
  strana?: number
}

/** What the server is asked for: one page of the documents that match. */
export interface DocumentQuery {
  q?: string
  kategorie?: string
  rok?: YearFilter
  typ?: FileKindFilter
  razeni?: SortOrder
  stranka?: number
  pocet?: number
  /** Only the administrator may ask for a status other than `ready`. */
  stav?: DocumentStatus
}

/** A document in a list, with the place in its content that matched the search. */
export interface FoundDocument extends ArchiveDocument {
  /** A few words of the content around the searched words; `null` when the content did not match. */
  snippet: string | null
}

export interface DocumentPage {
  documents: FoundDocument[]
  /** How many documents match, over all pages. */
  total: number
  /** The page that was returned; a request past the end gets the last page. */
  page: number
  pageCount: number
  /** Rows a full page holds. */
  pageSize: number
  /** Documents of each category that match the search and the other filters, by category id. */
  categoryCounts: Record<string, number>
  /** Years that at least one document the reader may see carries, newest first. */
  years: number[]
  /** How many documents the reader may see when nothing is searched or filtered. */
  archiveTotal: number
  /** Documents whose processing failed. Counted only for the administrator. */
  failedCount: number
}

/** The description shown to visitors: the administrator's own text wins over the automatic short one. */
export function shownDescription(document: ArchiveDocument): string {
  return document.customDescription.trim() === ''
    ? document.shortDescription
    : document.customDescription
}

export interface ArchiveSnapshot {
  categories: Category[]
  /** Whether this browser holds an administrator session. */
  isAdmin: boolean
  /** How the browser hands a file over: straight to blob storage, or to this application. */
  storageMode: 'blob' | 'local'
  /** Grows by one each time the archive is read again; lists of documents reload on it. */
  revision: number
}

/** Tokens and money spent on calls to AI models. */
export interface UsageTotals {
  /** Processing runs; one run reads one document once. */
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

/** One call to a model inside a session: what was asked and what came back. */
export interface SessionCall {
  id: number
  operation:
    | 'read-page'
    | 'read-mixed-page'
    | 'describe-image'
    | 'summarize'
    | 'categorize'
    | 'optimize'
    | 'embed'
    | 'chat'
    | 'weigh'
    | 'rerank'
    | 'glossary'
  model: string
  /** The place the call was made at; in older records the key of one skill. */
  skillKey: string | null
  /** 0 is the starting wording of the skill. */
  skillVersion: number
  /** Every skill the call was told, with the version of its text; `null` in older records. */
  skills: { key: string; version: number }[] | null
  page: number | null
  input: string
  output: string
  error: string | null
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number | null
}

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
  calls: SessionCall[]
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

export interface DocumentChanges {
  title: string
  categoryId: string
  customDescription: string
  issuedYear: number | null
  /** `YYYY-MM-DD`; its year then replaces `issuedYear`. */
  issuedOn: string | null
}

/** A piece of a document that one branch of the search found. */
export interface ChatHit {
  chunkId: number
  documentId: string
  documentTitle: string
  page: number | null
  /** Place in the branch's own order, from one. */
  rank: number
  /** BM25 score (higher is better) or cosine distance (lower is better). */
  score: number
}

/** A piece after both branches were joined; these go to the model. */
export interface ChatPassage {
  /** The number the model cites the piece by. */
  number: number
  chunkId: number
  documentId: string
  documentTitle: string
  page: number | null
  text: string
  /** Place in each branch, `null` when the branch did not find the piece. */
  wordRank: number | null
  meaningRank: number | null
  /** Sum of weight / (k + rank) over the branches. */
  fusedScore: number
  /** Place after the fusion, from one; the reranker may have moved the piece from it. */
  fusedRank?: number
  /** What the reranker gave, 0 to 1; absent when no reranker ran. */
  rerankScore?: number
}

/** How much each branch counts in the fusion of one search, and why. */
export interface ChatWeights {
  model: string
  /** What kind of query the model sees: probabilities of exact words, of both, of meaning. */
  exact: number
  both: number
  paraphrase: number
  /** The weights of the two branches; both are 1 with `error`. */
  words: number
  meaning: number
  /** Only in older traces, where the weights had a call of their own. */
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number | null
  error: string | null
}

/** One piece the reranker scored, whether it went to the model or not. */
export interface ChatRerankCandidate {
  chunkId: number
  documentTitle: string
  page: number | null
  fusedRank: number
  /** Place in the fusion with equal weights, i.e. without the decision model. */
  plainRank?: number | null
  score: number
  /** Whether the piece went to the model. */
  kept: boolean
  /** Whether the piece would have gone to the model without the decision model. */
  baselineKept?: boolean
}

/**
 * A piece the model would have got without the decision model: fusion with
 * equal weights and no reranking. Kept only to compare; never used for an answer.
 */
export interface ChatBaselinePassage {
  chunkId: number
  documentTitle: string
  page: number | null
  text: string
  /** Place in the plain fusion, from one. */
  rank: number
  /** What the reranker gave the piece; `null` when the reranking failed. */
  score: number | null
  /** Whether the piece went to the model with the decision model too. */
  kept: boolean
}

/** The reranking of one search; with `error` the order of the fusion was kept. */
export interface ChatRerank {
  model: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  /** Highest score first. */
  candidates: ChatRerankCandidate[]
  error: string | null
}

export type ChatTraceStep =
  | {
      kind: 'model'
      /** Counted from one. */
      step: number
      model: string
      /** What the model wrote in this step; empty when it only asked for a search or a calculation. */
      text: string
      /** The searches the model asked for in this step. */
      searches: string[]
      /** How many calculations the model asked for in this step; absent in traces older than them. */
      calculations?: number
      /** Time the model took, without the searches it asked for. */
      durationMs: number
      /** All of the input, the part read from the provider's cache included. */
      inputTokens: number
      /** Input read from the provider's cache, which costs less; absent in traces older than the cache. */
      cachedInputTokens?: number
      outputTokens: number
      costUsd: number | null
    }
  | {
      kind: 'search'
      query: string
      durationMs: number
      /** Tokens the embedding of the query used. */
      embeddingTokens: number
      words: ChatHit[]
      meaning: ChatHit[]
      passages: ChatPassage[]
      /** Both absent when no decision model is set up, and in traces older than it. */
      weights?: ChatWeights
      rerank?: ChatRerank
      baseline?: ChatBaselinePassage[]
    }
  | {
      kind: 'calculation'
      /** The script as the model wrote it: the body of a function that gets `parametry`. */
      script: string
      /** The data the model gave the script, as JSON. */
      parameters: string
      /** What the script returned, as JSON; `null` when it failed. */
      result: string | null
      /** What went wrong, as the model was told; `null` when the script ran. */
      error: string | null
      /** False when the run was refused because the calculations were used up. */
      ran: boolean
      durationMs: number
    }

/** A place in a document that an answer leans on. */
export interface ChatSource {
  documentId: string
  /** Page of a PDF; an image has none. */
  page?: number
}

/** One earlier message of the conversation, as the server rebuilt it from the session's traces. */
export interface ChatTurn {
  role: 'visitor' | 'archive'
  text: string
}

/** What an answer may draw from: every public document, or only the documents the visitor chose. */
export type ChatScope = 'archive' | 'documents'
/** The most documents one question may be bound to. */
export const MAX_CHAT_DOCUMENTS = 20

export interface ChatQuestion {
  question: string
  /**
   * The session to continue; absent for the first question of a conversation.
   * An id the server does not know starts a new session.
   */
  sessionId?: string
  scope: ChatScope
  /** The documents to answer from; used when the scope is `documents`. */
  documentIds: string[]
}

export type ChatAnswer =
  | {
      ok: true
      text: string
      sources: ChatSource[]
      traceId: string
      /** Sent back with the next question, so the server has the whole conversation. */
      sessionId: string
    }
  | { ok: false; problem: 'hourly-limit' | 'daily-limit' | 'not-set-up' | 'failed' }

export interface ChatTraceSummary {
  id: string
  at: string
  question: string
  failed: boolean
  searches: number
  durationMs: number
  costUsd: number | null
  /** Whether the visitor found in the answer what they were looking for; `null` when they did not say. */
  helpful: boolean | null
}

export interface ChatTrace extends ChatTraceSummary {
  sessionId: string
  /** What the model was told of the conversation before this question. */
  history: ChatTurn[]
  answer: string
  error: string | null
  /** The last two are in traces older than the choice of documents. */
  scope: ChatScope | 'shown' | 'document'
  model: string
  steps: ChatTraceStep[]
  setup: Record<string, string | number>
}

/** One conversation in the debugger's list: the questions of a session added up. */
export interface ChatSessionSummary {
  sessionId: string
  /** The session is named after it. */
  firstQuestion: string
  questions: number
  /** When the last question was asked. */
  lastAt: string
  durationMs: number
  /** Over all questions; `null` when no call had a known price. */
  costUsd: number | null
  /** Whether any question of the session got no answer. */
  failed: boolean
  /** How many answers of the session the visitor said helped. */
  helpfulAnswers: number
  /** How many answers of the session the visitor said did not help. */
  unhelpfulAnswers: number
}

/** Which sessions the debugger lists, by what the visitor said of their answers. */
export const CHAT_FEEDBACK_FILTERS = ['all', 'rated', 'helpful', 'unhelpful'] as const
export type ChatFeedbackFilter = (typeof CHAT_FEEDBACK_FILTERS)[number]
