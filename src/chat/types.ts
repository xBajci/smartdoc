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
      kind: 'summary'
      model: string
      /** What the models are told in place of the earlier questions; empty when the summary failed. */
      text: string
      /** How many questions it stands for. */
      questions: number
      /** Why there is no summary; then the whole history was sent. */
      error: string | null
      durationMs: number
      inputTokens: number
      cachedInputTokens?: number
      outputTokens: number
      costUsd: number | null
    }
  | {
      kind: 'rewrite'
      model: string
      /** The queries of the first search; empty when the conversation already holds the answer. */
      queries: string[]
      /** Why the model gave no queries; then the question itself was searched. */
      error: string | null
      durationMs: number
      inputTokens: number
      cachedInputTokens?: number
      outputTokens: number
      costUsd: number | null
    }
  | {
      kind: 'model'
      /** Counted from one. */
      step: number
      model: string
      /** What the model wrote in this step; empty when it only asked for a search or a calculation. */
      text: string
      /** The searches the model asked for in this step. */
      searches: string[]
      /** Searches it asked for after the searches were used up; they did not run. */
      refusedSearches?: string[]
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

/** One earlier message of the conversation, as the server rebuilt it from the conversation's traces. */
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
   * The conversation to continue; absent for the first question of a conversation.
   * An id the server does not know starts a new conversation.
   */
  conversationId?: string
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
      conversationId: string
    }
  | { ok: false; problem: 'hourly-limit' | 'daily-limit' | 'not-set-up' | 'failed' }

/**
 * What the chat starts doing while it makes an answer, told to the visitor as
 * it happens: a search (`lastSearch` when no other may follow), the decision
 * model ranking what it found, the chat model reading the pieces of a search,
 * and once the model answered, the check of its citations and the sources
 * they point at.
 */
export type ChatProgress = 'search' | 'lastSearch' | 'rank' | 'read' | 'check' | 'sources'

/** What the chat sends while a question is answered: its progress, and at last the answer. */
export type ChatUpdate =
  | { kind: 'progress'; progress: ChatProgress }
  | { kind: 'answer'; answer: ChatAnswer }

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
  conversationId: string
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

/** One conversation in the debugger's list: the questions of a conversation added up. */
export interface ChatConversationSummary {
  conversationId: string
  /** The conversation is named after it. */
  firstQuestion: string
  questions: number
  /** When the last question was asked. */
  lastAt: string
  durationMs: number
  /** Over all questions; `null` when no call had a known price. */
  costUsd: number | null
  /** Whether any question of the conversation got no answer. */
  failed: boolean
  /** How many answers of the conversation the visitor said helped. */
  helpfulAnswers: number
  /** How many answers of the conversation the visitor said did not help. */
  unhelpfulAnswers: number
}

/** Which conversations the debugger lists, by what the visitor said of their answers. */
export const CHAT_FEEDBACK_FILTERS = ['all', 'rated', 'helpful', 'unhelpful'] as const

export type ChatFeedbackFilter = (typeof CHAT_FEEDBACK_FILTERS)[number]

export interface ChatMessage {
  id: string
  role: 'visitor' | 'archive'
  /** Marks like [1] in the text point at `sources`, counted from one. */
  text: string
  sources?: ChatSource[]
  /** The answer is still being made. */
  pending?: boolean
  /**
   * What the chat has started doing for a pending answer, oldest first.
   * `almost` is the panel's own: the answer is taking a while to write.
   */
  progress?: (ChatProgress | 'almost')[]
  /** The message says why there is no answer; it is not part of the conversation. */
  failed?: boolean
  /** The record of an answer on the server; what the visitor says of the answer is stored under it. */
  traceId?: string
  /** Whether the visitor found in the answer what they were looking for; `undefined` until they say. */
  helpful?: boolean
  /** Where the last word of the visitor about the answer is on its way to the server. */
  rating?: 'storing' | 'thanked' | 'failed'
}
