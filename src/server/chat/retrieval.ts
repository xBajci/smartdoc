import { and, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm'
import { searchWords } from '../../archive/query'
import type {
  ChatBaselinePassage,
  ChatHit,
  ChatPassage,
  ChatQuestion,
  ChatRerank,
  ChatTraceStep,
  ChatWeights,
} from '../../archive/types'
import { getDatabase } from '../../db/client'
import { documentChunks, documents } from '../../db/schema'
import { modelName } from '../ai/models'
import { costOfCall } from '../ai/prices'
import { branchWeights, orderByScore, type Decider } from './decisions'
import type { Embedder } from './embedder'
import { fuseRanks } from './fusion'
import type { ChatSettings } from './settings'

/** Name of the BM25 index from migration 0006; the ranking needs it by name. */
const BM25_INDEX = 'document_chunks_bm25_idx'
/** Characters of a query that take part in the word search. */
const MAX_QUERY_CHARACTERS = 400

export type SearchStep = Extract<ChatTraceStep, { kind: 'search' }>

export interface SearchScope {
  scope: ChatQuestion['scope']
  documentIds: ChatQuestion['documentIds']
}

/** Only public documents, and only the chosen ones when the visitor chose some. */
function allowed({ scope, documentIds }: SearchScope): SQL | undefined {
  return and(
    eq(documents.status, 'ready'),
    scope === 'documents' ? inArray(documents.id, documentIds) : undefined,
  )
}

const hitColumns = {
  chunkId: documentChunks.id,
  documentId: documents.id,
  documentTitle: documents.title,
  page: documentChunks.page,
}

/**
 * The word branch: BM25 over the name and the text of every piece. This is
 * the one place that knows the pg_textsearch extension.
 */
export async function searchByWords(
  query: string,
  scope: SearchScope,
  limit: number,
): Promise<ChatHit[]> {
  if (searchWords(query).length === 0) return []
  // The query goes in whole: the database splits it into words the way it split
  // the text, so "4/2025" stays one word on both sides.
  const text = query.slice(0, MAX_QUERY_CHARACTERS)
  // The operator gives a negative number, the lower the better, and zero for no match.
  const score = sql<number>`${documentChunks.indexed} <@> to_bm25query(${text}, ${BM25_INDEX})`
  const rows = await getDatabase()
    .select({ ...hitColumns, score })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(and(allowed(scope), sql`${score} < 0`))
    .orderBy(score, documentChunks.id)
    .limit(limit)
  return rows.map((row, index) => ({ ...row, rank: index + 1, score: -row.score }))
}

/** The meaning branch: the pieces whose embedding lies closest to the embedding of the query. */
export async function searchByMeaning(
  vector: readonly number[],
  model: string,
  scope: SearchScope,
  limit: number,
): Promise<ChatHit[]> {
  const distance = sql<number>`${documentChunks.embedding} <=> ${JSON.stringify(vector)}::vector`
  const rows = await getDatabase()
    .select({ ...hitColumns, score: distance })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(
      and(
        allowed(scope),
        isNotNull(documentChunks.embedding),
        // A vector of another model lives in another space and cannot be compared.
        eq(documentChunks.embeddingModel, model),
      ),
    )
    .orderBy(distance, documentChunks.id)
    .limit(limit)
  return rows.map((row, index) => ({ ...row, rank: index + 1 }))
}

export interface SearchTools {
  embed: Embedder
  /** `null` when no decision model is set up: both branches weigh the same and nothing is reranked. */
  decider: Decider | null
  /** The skills for judging a passage, as one text. */
  rerankGuidance: string
  settings: ChatSettings
  /** Gives a piece the number the model cites it by; a piece found twice keeps its number. */
  numberOf: (chunkId: number) => number
  /** Called when the reranker starts, so the visitor learns of it. */
  onRerank?: () => void
}

const message = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught))

/** Asks how much each branch should count. A failure costs nothing: the branches stay equal. */
async function weighBranches(
  question: string,
  query: string,
  { decider, settings }: SearchTools,
): Promise<ChatWeights | undefined> {
  if (decider === null) return undefined
  const started = Date.now()
  try {
    const { model, inputTokens, outputTokens, ...kind } = await decider.weigh(question, query)
    return {
      model,
      ...kind,
      ...branchWeights(kind, settings.weightSpread),
      durationMs: Date.now() - started,
      inputTokens,
      outputTokens,
      costUsd: costOfCall(model, inputTokens, outputTokens),
      error: null,
    }
  } catch (caught) {
    console.error('The branches of the chat search were not weighed:', caught)
    return {
      model: modelName('decision'),
      exact: 0,
      both: 0,
      paraphrase: 0,
      words: 1,
      meaning: 1,
      durationMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      error: message(caught),
    }
  }
}

/**
 * Hybrid search: both branches run, their orders are joined by rank fusion
 * with the weights the decision model gave, the reranker scores the best of
 * them and the pieces it likes most come back with their text. Without a
 * decision model the order of the plain fusion stays.
 */
export async function hybridSearch(
  question: string,
  query: string,
  scope: SearchScope,
  tools: SearchTools,
): Promise<SearchStep> {
  const { embed, decider, rerankGuidance, settings, numberOf } = tools
  const started = Date.now()
  // The weighing runs beside the branches, so it adds no waiting.
  const [words, embedded, weights] = await Promise.all([
    searchByWords(query, scope, settings.branchLimit),
    embed([query]),
    weighBranches(question, query, tools),
  ])
  const vector = embedded.vectors[0]
  const meaning =
    vector === undefined
      ? []
      : await searchByMeaning(vector, embedded.model, scope, settings.branchLimit)

  // The fusion runs twice. `plain` is the search without the decision model:
  // equal weights, no reranking. It is never used for the answer, only kept
  // in the trace so the two orders can be compared.
  const plain = fuseRanks(words, meaning, settings.rrfK, Infinity)
  const plainRankOf = new Map(plain.map((item, index) => [item.chunkId, index + 1]))
  const inBaseline = (chunkId: number) =>
    (plainRankOf.get(chunkId) ?? Infinity) <= settings.passages
  const ranked = fuseRanks(words, meaning, settings.rrfK, Infinity, weights).map((item, index) => ({
    ...item,
    fusedRank: index + 1,
  }))
  const scored = decider === null ? settings.passages : settings.rerankCandidates
  // The reranker also scores the pieces of the baseline, so every one of them has a score to compare.
  const fused = ranked.filter(
    (item) => item.fusedRank <= Math.max(settings.passages, scored) || inBaseline(item.chunkId),
  )
  const texts =
    fused.length === 0
      ? []
      : await getDatabase()
          .select({ id: documentChunks.id, text: documentChunks.text })
          .from(documentChunks)
          .where(
            inArray(
              documentChunks.id,
              fused.map((item) => item.chunkId),
            ),
          )
  const textOf = new Map(texts.map((row) => [row.id, row.text]))
  const hitOf = new Map([...meaning, ...words].map((hit) => [hit.chunkId, hit]))

  /** The pieces in the order of the fusion; they get their numbers only when they go to the model. */
  const candidates = fused.flatMap((item) => {
    const hit = hitOf.get(item.chunkId)
    const text = textOf.get(item.chunkId)
    if (hit === undefined || text === undefined) return []
    return [{ ...item, hit, text, plainRank: plainRankOf.get(item.chunkId) ?? null }]
  })

  let kept = candidates.slice(0, settings.passages).map((candidate) => ({
    candidate,
    rerankScore: undefined as number | undefined,
  }))
  let rerank: ChatRerank | undefined
  if (decider !== null && candidates.length > 0) {
    tools.onRerank?.()
    const rerankStarted = Date.now()
    try {
      const { scores, model, inputTokens, outputTokens } = await decider.rerank(
        question,
        query,
        candidates.map(({ hit, text }) => ({ title: hit.documentTitle, text })),
        rerankGuidance,
      )
      const order = orderByScore(scores, candidates.length)
      const chosen = new Set(order.slice(0, settings.passages))
      kept = order.slice(0, settings.passages).flatMap((index) => {
        const candidate = candidates[index]
        return candidate === undefined ? [] : [{ candidate, rerankScore: scores[index] }]
      })
      rerank = {
        model,
        durationMs: Date.now() - rerankStarted,
        inputTokens,
        outputTokens,
        costUsd: costOfCall(model, inputTokens, outputTokens),
        candidates: order.flatMap((index) => {
          const candidate = candidates[index]
          if (candidate === undefined) return []
          return [
            {
              chunkId: candidate.chunkId,
              documentTitle: candidate.hit.documentTitle,
              page: candidate.hit.page,
              fusedRank: candidate.fusedRank,
              plainRank: candidate.plainRank,
              score: scores[index] ?? 0,
              kept: chosen.has(index),
              baselineKept: inBaseline(candidate.chunkId),
            },
          ]
        }),
        error: null,
      }
    } catch (caught) {
      // The search still answers, in the order of the fusion.
      console.error('The pieces of the chat search were not reranked:', caught)
      rerank = {
        model: modelName('decision'),
        durationMs: Date.now() - rerankStarted,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        candidates: [],
        error: message(caught),
      }
    }
  }

  const passages = kept.map(({ candidate, rerankScore }): ChatPassage => ({
    number: numberOf(candidate.chunkId),
    chunkId: candidate.chunkId,
    documentId: candidate.hit.documentId,
    documentTitle: candidate.hit.documentTitle,
    page: candidate.hit.page,
    text: candidate.text,
    wordRank: candidate.wordRank,
    meaningRank: candidate.meaningRank,
    fusedScore: candidate.fusedScore,
    fusedRank: candidate.fusedRank,
    ...(rerankScore === undefined ? {} : { rerankScore }),
  }))

  /** What the model would have got without the decision model. */
  const scoreOf = new Map(rerank?.candidates.map((item) => [item.chunkId, item.score]))
  const sent = new Set(passages.map((passage) => passage.chunkId))
  const baseline = candidates
    .filter((candidate) => inBaseline(candidate.chunkId))
    .sort((a, b) => (a.plainRank ?? 0) - (b.plainRank ?? 0))
    .map((candidate): ChatBaselinePassage => ({
      chunkId: candidate.chunkId,
      documentTitle: candidate.hit.documentTitle,
      page: candidate.hit.page,
      text: candidate.text,
      rank: candidate.plainRank ?? 0,
      score: scoreOf.get(candidate.chunkId) ?? null,
      kept: sent.has(candidate.chunkId),
    }))

  return {
    kind: 'search',
    query,
    durationMs: Date.now() - started,
    embeddingTokens: embedded.tokens,
    words,
    meaning,
    passages,
    ...(weights === undefined ? {} : { weights }),
    ...(decider === null ? {} : { baseline }),
    ...(rerank === undefined ? {} : { rerank }),
  }
}

/** The passages as the model reads them. */
export function passagesForModel(passages: readonly ChatPassage[]): string {
  return passages
    .map((passage) => {
      const place = passage.page === null ? '' : `, strana ${passage.page}`
      return `[${passage.number}] Dokument: ${passage.documentTitle}${place}\n${passage.text}`
    })
    .join('\n\n')
}
