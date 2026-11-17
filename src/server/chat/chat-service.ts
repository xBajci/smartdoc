import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import type {
  ChatAnswer,
  ChatPassage,
  ChatQuestion,
  ChatSessionSummary,
  ChatTrace,
  ChatTraceStep,
  ChatTraceSummary,
  ChatTurn,
} from '../../archive/types'
import { getDatabase } from '../../db/client'
import { aiUsage, chatTraces } from '../../db/schema'
import { missingKey, modelName } from '../ai/models'
import { costOfCall } from '../ai/prices'
import { instructionsFor } from '../ai/skills'
import { loadSkills } from '../skills-service'
import { getAnswerer } from './answerer'
import { resolveCitations } from './citations'
import { getDecider } from './decisions'
import { getEmbedder } from './embedder'
import { historyFromTraces } from './history'
import { CHAT_FIXED } from './instructions'
import { hybridSearch } from './retrieval'
import { chatSettings } from './settings'

const HOUR_MS = 3_600_000
const RECENT_SESSIONS = 100
/** How much of a question names its session in the records of AI calls. */
const TITLE_CHARACTERS = 80

/** One call as the records of AI calls keep it. */
interface UsageCall {
  operation: 'chat' | 'embed' | 'weigh' | 'rerank'
  /** The place the call was made at and the skills it was told; a search has none. */
  skillKey?: string
  skills?: { key: string; version: number }[]
  model: string
  input: string
  output: string
  error: string | null
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number | null
}

export interface Asker {
  /** The administrator tries questions in the debugger and has no limit. */
  admin: boolean
  /** Stands for the visitor's address; see `clientKey`. */
  hash: string
}

async function overLimit(asker: Asker): Promise<'hourly-limit' | 'daily-limit' | null> {
  if (asker.admin) return null
  const { hourlyLimit, dailyLimit } = chatSettings()
  const database = getDatabase()
  const since = (ms: number) => gt(chatTraces.createdAt, new Date(Date.now() - ms))
  const [[hour], [day]] = await Promise.all([
    database
      .select({ total: count() })
      .from(chatTraces)
      .where(and(eq(chatTraces.askerHash, asker.hash), since(HOUR_MS))),
    database
      .select({ total: count() })
      .from(chatTraces)
      .where(and(isNotNull(chatTraces.askerHash), since(24 * HOUR_MS))),
  ])
  if ((hour?.total ?? 0) >= hourlyLimit) return 'hourly-limit'
  if ((day?.total ?? 0) >= dailyLimit) return 'daily-limit'
  return null
}

/**
 * The session a question joins and what the model is told of it. A question
 * without a session, or with one no trace knows, starts a new session under a
 * fresh id: the client never gets to choose an id of its own.
 */
async function joinSession(
  sessionId: string | undefined,
  historyMessages: number,
): Promise<{ sessionId: string; history: ChatTurn[] }> {
  if (sessionId === undefined) return { sessionId: randomUUID(), history: [] }
  const earlier = await getDatabase()
    .select({ question: chatTraces.question, answer: chatTraces.answer, error: chatTraces.error })
    .from(chatTraces)
    .where(eq(chatTraces.sessionId, sessionId))
    .orderBy(asc(chatTraces.createdAt))
  if (earlier.length === 0) return { sessionId: randomUUID(), history: [] }
  return { sessionId, history: historyFromTraces(earlier, historyMessages) }
}

/**
 * Answers one question and leaves a trace of how the answer came to be. The
 * trace and the cost are written whether the answer was made or not.
 */
export async function askArchive(input: ChatQuestion, asker: Asker): Promise<ChatAnswer> {
  const limit = await overLimit(asker)
  if (limit !== null) return { ok: false, problem: limit }
  if ((missingKey('chat') ?? missingKey('embedding')) !== null) {
    return { ok: false, problem: 'not-set-up' }
  }

  const settings = chatSettings()
  const id = randomUUID()
  const started = Date.now()
  const { sessionId, history } = await joinSession(input.sessionId, settings.historyMessages)
  const steps: ChatTraceStep[] = []
  const embed = getEmbedder()
  const decider = getDecider()
  // What the models of this question are told: the system prompt and the skills of the chat.
  const skills = await loadSkills()
  const answerInstructions = instructionsFor(skills, 'chat-answer', CHAT_FIXED)
  const rerankGuidance = instructionsFor(skills, 'chat-rerank')
  let embeddingModel = modelName('embedding')

  /** Numbers of pieces, shared by all searches of the question. */
  const numbers = new Map<number, number>()
  const numberOf = (chunkId: number) => {
    const known = numbers.get(chunkId)
    if (known !== undefined) return known
    numbers.set(chunkId, numbers.size + 1)
    return numbers.size
  }

  let answer = ''
  let error: string | null = null
  try {
    answer = await getAnswerer()({
      question: input.question,
      instructions: answerInstructions.text,
      history,
      settings,
      trace: (step) => steps.push(step),
      search: (query) =>
        hybridSearch(input.question, query, input, {
          embed: async (texts) => {
            const embedded = await embed(texts)
            embeddingModel = embedded.model
            return embedded
          },
          decider,
          rerankGuidance: rerankGuidance.text,
          settings,
          numberOf,
        }),
    })
  } catch (caught) {
    console.error(`Chat question ${id} failed:`, caught)
    error = caught instanceof Error ? caught.message : String(caught)
  }

  const passages = steps.flatMap((step): ChatPassage[] =>
    step.kind === 'search' ? step.passages : [],
  )
  const resolved = resolveCitations(answer, passages)

  const usage = steps.flatMap((step): UsageCall[] => {
    if (step.kind === 'model') {
      return [
        {
          operation: 'chat',
          skillKey: 'chat-answer',
          skills: answerInstructions.skills,
          model: step.model,
          input: step.step === 1 ? input.question : 'Úryvky z předchozího hledání.',
          output: step.text === '' ? `Hledat: ${step.searches.join(' | ')}` : step.text,
          error: null,
          durationMs: step.durationMs,
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
          costUsd: step.costUsd,
        },
      ]
    }
    const { weights, rerank } = step
    const decisions = rerank?.durationMs ?? 0
    const calls: UsageCall[] = [
      {
        operation: 'embed',
        model: embeddingModel,
        input: step.query,
        output: `Úryvků: ${step.passages.length}`,
        error: null,
        // The weighing runs beside the branches; the reranking after them.
        durationMs: Math.max(0, step.durationMs - decisions),
        inputTokens: step.embeddingTokens,
        outputTokens: 0,
        costUsd: costOfCall(embeddingModel, step.embeddingTokens, 0),
      },
    ]
    if (weights !== undefined) {
      calls.push({
        operation: 'weigh',
        model: weights.model,
        input: step.query,
        output: `Váhy: slova ${weights.words.toFixed(2)}, význam ${weights.meaning.toFixed(2)}`,
        error: weights.error,
        durationMs: weights.durationMs ?? 0,
        inputTokens: weights.inputTokens ?? 0,
        outputTokens: weights.outputTokens ?? 0,
        costUsd: weights.costUsd ?? null,
      })
    }
    if (rerank !== undefined) {
      calls.push({
        operation: 'rerank',
        skillKey: 'chat-rerank',
        skills: rerankGuidance.skills,
        model: rerank.model,
        input: step.query,
        output: `Ohodnoceno úryvků: ${rerank.candidates.length}`,
        error: rerank.error,
        durationMs: rerank.durationMs,
        inputTokens: rerank.inputTokens,
        outputTokens: rerank.outputTokens,
        costUsd: rerank.costUsd,
      })
    }
    return calls
  })
  const priced = usage.filter((call) => call.costUsd !== null)

  const database = getDatabase()
  await database.insert(chatTraces).values({
    id,
    sessionId,
    question: input.question,
    history,
    answer: resolved.text,
    error,
    scope: input.scope,
    model: modelName('chat'),
    steps,
    setup: {
      ...settings,
      embeddingModel,
      decisionModel: decider === null ? 'off' : modelName('decision'),
      instructions: answerInstructions.text,
    },
    durationMs: Date.now() - started,
    costUsd:
      priced.length === 0 ? null : priced.reduce((sum, call) => sum + (call.costUsd ?? 0), 0),
    askerHash: asker.admin ? null : asker.hash,
  })
  if (usage.length > 0) {
    await database
      .insert(aiUsage)
      .values(
        usage.map((call) => ({
          runId: id,
          documentId: null,
          documentTitle: `Chat: ${input.question.slice(0, TITLE_CHARACTERS)}`,
          format: null,
          skillKey: null,
          skills: null,
          page: null,
          ...call,
        })),
      )
      .catch((caught: unknown) => console.error('Chat usage was not recorded:', caught))
  }

  if (error !== null || resolved.text === '') return { ok: false, problem: 'failed' }
  return { ok: true, text: resolved.text, sources: resolved.sources, traceId: id, sessionId }
}

const summaryColumns = {
  id: chatTraces.id,
  createdAt: chatTraces.createdAt,
  question: chatTraces.question,
  error: chatTraces.error,
  steps: chatTraces.steps,
  durationMs: chatTraces.durationMs,
  costUsd: chatTraces.costUsd,
}

function toSummary(row: {
  id: string
  createdAt: Date
  question: string
  error: string | null
  steps: ChatTraceStep[]
  durationMs: number
  costUsd: number | null
}): ChatTraceSummary {
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    question: row.question,
    failed: row.error !== null,
    searches: row.steps.filter((step) => step.kind === 'search').length,
    durationMs: row.durationMs,
    costUsd: row.costUsd,
  }
}

/** The sessions with the most recent questions, newest activity first. */
export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  // Decoded like the column itself; the driver would hand a bare aggregate over as text.
  const lastAt = sql`max(${chatTraces.createdAt})`.mapWith(chatTraces.createdAt)
  const rows = await getDatabase()
    .select({
      sessionId: chatTraces.sessionId,
      firstQuestion: sql<string>`(array_agg(${chatTraces.question} order by ${chatTraces.createdAt}))[1]`,
      questions: count(),
      lastAt,
      durationMs: sql<number>`sum(${chatTraces.durationMs})::int`,
      // The sum of nothing but unknown prices is null, like the price of one such question.
      costUsd: sql<number | null>`sum(${chatTraces.costUsd})`,
      failed: sql<boolean>`bool_or(${chatTraces.error} is not null)`,
    })
    .from(chatTraces)
    .groupBy(chatTraces.sessionId)
    .orderBy(desc(lastAt))
    .limit(RECENT_SESSIONS)
  return rows.map((row) => ({ ...row, lastAt: row.lastAt.toISOString() }))
}

/** The questions of one session, oldest first; empty when no trace has the id. */
export async function findChatSession(sessionId: string): Promise<ChatTraceSummary[]> {
  const rows = await getDatabase()
    .select(summaryColumns)
    .from(chatTraces)
    .where(eq(chatTraces.sessionId, sessionId))
    .orderBy(asc(chatTraces.createdAt))
  return rows.map(toSummary)
}

export async function findChatTrace(id: string): Promise<ChatTrace | null> {
  const [row] = await getDatabase().select().from(chatTraces).where(eq(chatTraces.id, id))
  if (row === undefined) return null
  return {
    ...toSummary(row),
    sessionId: row.sessionId,
    history: row.history,
    answer: row.answer,
    error: row.error,
    scope: row.scope,
    model: row.model,
    steps: row.steps,
    setup: row.setup,
  }
}
