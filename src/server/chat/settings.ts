/**
 * The numbers the chat runs with. Each can be changed in `.env` by the name in
 * the comment, without touching code; a value that is not a positive number is ignored.
 */
function setting(variable: string, fallback: number): number {
  const value = Number(process.env[variable])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function chatSettings() {
  return {
    /** CHAT_CHUNK_CHARACTERS: the most characters in one piece of a document. */
    chunkCharacters: setting('CHAT_CHUNK_CHARACTERS', 1200),
    /** CHAT_CHUNK_OVERLAP: characters a piece repeats from the end of the piece before it. */
    chunkOverlap: setting('CHAT_CHUNK_OVERLAP', 150),
    /** CHAT_BRANCH_LIMIT: pieces each branch of the search returns. */
    branchLimit: setting('CHAT_BRANCH_LIMIT', 20),
    /** CHAT_PASSAGES: pieces of one search that go to the model. */
    passages: setting('CHAT_PASSAGES', 6),
    /** CHAT_WEIGHT_SPREAD: how far a branch weight may move from 1; at 0.5 the weights run from 0.5 to 1.5. */
    weightSpread: setting('CHAT_WEIGHT_SPREAD', 0.5),
    /** CHAT_RERANK_CANDIDATES: pieces after the fusion that the reranker scores. */
    rerankCandidates: setting('CHAT_RERANK_CANDIDATES', 20),
    /** CHAT_RRF_K: the constant of the rank fusion; a higher one evens the ranks out. */
    rrfK: setting('CHAT_RRF_K', 60),
    /** CHAT_MAX_SEARCHES: searches the model may make for one question. */
    maxSearches: setting('CHAT_MAX_SEARCHES', 3),
    /** CHAT_MAX_CALCULATIONS: scripts that ran without an error, which the model may have for one question. */
    maxCalculations: setting('CHAT_MAX_CALCULATIONS', 3),
    /** CHAT_MAX_ERRORED_RUNS: scripts that ended in an error; they do not count as calculations, but this many end the calculating. */
    maxErroredRuns: setting('CHAT_MAX_ERRORED_RUNS', 3),
    /** CHAT_HISTORY_MESSAGES: earlier messages of the conversation the model sees. */
    historyMessages: setting('CHAT_HISTORY_MESSAGES', 12),
    /** CHAT_HOURLY_LIMIT: questions one visitor may ask in an hour. */
    hourlyLimit: setting('CHAT_HOURLY_LIMIT', 20),
    /** CHAT_DAILY_LIMIT: questions all visitors together may ask in a day. */
    dailyLimit: setting('CHAT_DAILY_LIMIT', 300),
  }
}

export type ChatSettings = ReturnType<typeof chatSettings>

/** The longest question that is accepted, and the most of an earlier message the model is told again. */
export const MAX_QUESTION_CHARACTERS = 1000
export const MAX_TURN_CHARACTERS = 4000
