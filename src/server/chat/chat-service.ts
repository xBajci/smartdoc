import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gt, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm'
import type {
  ChatAnswer,
  ChatFeedbackFilter,
  ChatPassage,
  ChatProgress,
  ChatQuestion,
  ChatSessionSummary,
  ChatTrace,
  ChatTraceStep,
  ChatTraceSummary,
  ChatTurn,
  ChatUpdate,
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
import { chatFixed } from './instructions'
import { sendFeedback, traceQuestion, traceSearch, type Feedback } from './mlflow'
import { hybridSearch, type SearchScope } from './retrieval'
import { chatSettings, type ChatSettings } from './settings'

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

export interface AnswerRequest {
  question: string
  scope: SearchScope
  history: ChatTurn[]
  settings: ChatSettings
  /** The id of the question, as `chat_traces` will know it. */
  questionId: string
  sessionId: string
  /** More tags for the trace in MLflow. */
  tags?: Record<string, string>
  /** Hears what the chat starts doing, so the visitor can be told while they wait. */
  report?: (progress: ChatProgress) => void
}

export interface AnsweredQuestion {
  answer: string
  /** Why no answer was made; the steps until then are kept. */
  error: string | null
  steps: ChatTraceStep[]
  mlflowTraceId: string | null
  embeddingModel: string
  decider: ReturnType<typeof getDecider>
  answerInstructions: ReturnType<typeof instructionsFor>
  rerankGuidance: ReturnType<typeof instructionsFor>
}

/**
 * Answers one question the way the chat does: with its settings, its skills
 * and its searches, as one trace in MLflow. It writes nothing to the
 * database, so the test questions (`pnpm eval:run`) use it too.
 */
export async function answerQuestion(request: AnswerRequest): Promise<AnsweredQuestion> {
  const { question, scope, history, settings } = request
  const report = request.report ?? (() => undefined)
  let searches = 0
  const steps: ChatTraceStep[] = []
  const embed = getEmbedder()
  const decider = getDecider()
  // What the models of this question are told: the system prompt and the skills of the chat.
  const skills = await loadSkills()
  const answerInstructions = instructionsFor(skills, 'chat-answer', chatFixed())
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
  let mlflowTraceId: string | null = null
  const answerer = getAnswerer()
  try {
    answer = await traceQuestion(
      {
        question,
        questionId: request.questionId,
        sessionId: request.sessionId,
        tags: request.tags,
      },
      () =>
        answerer({
          question,
          instructions: answerInstructions.text,
          history,
          settings,
          trace: (step) => steps.push(step),
          search: async (query) => {
            searches += 1
            // A question allowed one search only has no "last" one to tell of.
            report(searches > 1 && searches >= settings.maxSearches ? 'lastSearch' : 'search')
            const found = await traceSearch(query, () =>
              hybridSearch(question, query, scope, {
                embed: async (texts) => {
                  const embedded = await embed(texts)
                  embeddingModel = embedded.model
                  return embedded
                },
                decider,
                rerankGuidance: rerankGuidance.text,
                settings,
                numberOf,
                onRerank: () => report('rank'),
              }),
            )
            // The pieces go to the model next, which reads them.
            report('read')
            return found
          },
        }),
      (traceId) => (mlflowTraceId = traceId),
    )
  } catch (caught) {
    console.error(`Chat question ${request.questionId} failed:`, caught)
    error = caught instanceof Error ? caught.message : String(caught)
  }
  return {
    answer,
    error,
    steps,
    mlflowTraceId,
    embeddingModel,
    decider,
    answerInstructions,
    rerankGuidance,
  }
}

/**
 * Answers one question and leaves a trace of how the answer came to be. The
 * trace and the cost are written whether the answer was made or not.
 */
export async function askArchive(
  input: ChatQuestion,
  asker: Asker,
  report?: (progress: ChatProgress) => void,
): Promise<ChatAnswer> {
  const limit = await overLimit(asker)
  if (limit !== null) return { ok: false, problem: limit }
  if ((missingKey('chat') ?? missingKey('embedding')) !== null) {
    return { ok: false, problem: 'not-set-up' }
  }

  const settings = chatSettings()
  const id = randomUUID()
  const started = Date.now()
  const { sessionId, history } = await joinSession(input.sessionId, settings.historyMessages)
  const {
    answer,
    error,
    steps,
    mlflowTraceId,
    embeddingModel,
    decider,
    answerInstructions,
    rerankGuidance,
  } = await answerQuestion({
    question: input.question,
    scope: input,
    history,
    settings,
    questionId: id,
    sessionId,
    report,
  })

  const passages = steps.flatMap((step): ChatPassage[] =>
    step.kind === 'search' ? step.passages : [],
  )
  if (error === null && answer !== '') report?.('check')
  const resolved = resolveCitations(answer, passages)
  if (resolved.sources.length > 0) report?.('sources')

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
    mlflowTraceId,
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

/**
 * Answers one question like `askArchive`, but yields what the chat starts
 * doing while it works, so the visitor sees the progress. The answer comes last.
 */
export async function* askArchiveLive(
  input: ChatQuestion,
  asker: Asker,
): AsyncGenerator<ChatUpdate> {
  const waiting: ChatUpdate[] = []
  let done = false
  let wake: (() => void) | undefined
  const push = (update: ChatUpdate) => {
    waiting.push(update)
    wake?.()
  }
  const work = askArchive(input, asker, (progress) => push({ kind: 'progress', progress }))
    .then((answer) => push({ kind: 'answer', answer }))
    .finally(() => {
      done = true
      wake?.()
    })
  // A failure is thrown below, after the progress before it was sent.
  work.catch(() => undefined)
  for (;;) {
    const next = waiting.shift()
    if (next !== undefined) {
      yield next
    } else if (done) {
      break
    } else {
      await new Promise<void>((resolve) => (wake = resolve))
      wake = undefined
    }
  }
  await work
}

/**
 * Stores what the visitor said of one answer: whether they found in it what
 * they were looking for. Saying it again replaces the earlier word. Only a
 * question that got an answer can be rated; `false` says nothing was stored.
 * A word that differs from the earlier one goes to MLflow too, without the
 * visitor waiting for it.
 */
export async function rateChatAnswer(traceId: string, helpful: boolean): Promise<boolean> {
  const [rated] = await getDatabase()
    .update(chatTraces)
    .set({ helpful, ratedAt: new Date() })
    .where(and(eq(chatTraces.id, traceId), isNull(chatTraces.error), ne(chatTraces.answer, '')))
    .returning({
      sessionId: chatTraces.sessionId,
      mlflowTraceId: chatTraces.mlflowTraceId,
      mlflowFeedbackId: chatTraces.mlflowFeedbackId,
      // A subquery sees the row as it was before this update.
      before: sql<
        boolean | null
      >`(select earlier.helpful from chat_traces earlier where earlier.id = "chat_traces"."id")`,
    })
  if (rated === undefined) return false
  if (rated.mlflowTraceId !== null && rated.before !== helpful) {
    void forwardFeedback(traceId, {
      mlflowTraceId: rated.mlflowTraceId,
      feedbackId: rated.mlflowFeedbackId,
      helpful,
      // The session stands for the visitor: MLflow sees which words came from one conversation.
      visitor: rated.sessionId,
    })
  }
  return true
}

/** Sends a word to MLflow and keeps the id it got there, so the next word updates it. */
async function forwardFeedback(traceId: string, feedback: Feedback) {
  const feedbackId = await sendFeedback(feedback)
  if (feedbackId === null || feedbackId === feedback.feedbackId) return
  await getDatabase()
    .update(chatTraces)
    .set({ mlflowFeedbackId: feedbackId })
    .where(eq(chatTraces.id, traceId))
    .catch((caught: unknown) =>
      console.error(`MLflow feedback of ${traceId} was not kept:`, caught),
    )
}

/** How many questions of a session carry the given word of the visitor. */
const answersRated = (helpful: boolean) =>
  sql<number>`(count(*) filter (where ${chatTraces.helpful} = ${helpful}))::int`

/** The sessions a filter of the debugger lets through: those with at least one such answer. */
const FEEDBACK_FILTERS: Record<ChatFeedbackFilter, SQL | undefined> = {
  all: undefined,
  rated: sql`count(${chatTraces.helpful}) > 0`,
  helpful: sql`bool_or(${chatTraces.helpful})`,
  unhelpful: sql`bool_or(not ${chatTraces.helpful})`,
}

const summaryColumns = {
  id: chatTraces.id,
  createdAt: chatTraces.createdAt,
  question: chatTraces.question,
  error: chatTraces.error,
  steps: chatTraces.steps,
  durationMs: chatTraces.durationMs,
  costUsd: chatTraces.costUsd,
  helpful: chatTraces.helpful,
}

function toSummary(row: {
  id: string
  createdAt: Date
  question: string
  error: string | null
  steps: ChatTraceStep[]
  durationMs: number
  costUsd: number | null
  helpful: boolean | null
}): ChatTraceSummary {
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    question: row.question,
    failed: row.error !== null,
    searches: row.steps.filter((step) => step.kind === 'search').length,
    durationMs: row.durationMs,
    costUsd: row.costUsd,
    helpful: row.helpful,
  }
}

/**
 * The sessions with the most recent questions, newest activity first. The
 * filter chooses before the count is cut, so it reaches older sessions too.
 */
export async function listChatSessions(
  filter: ChatFeedbackFilter = 'all',
): Promise<ChatSessionSummary[]> {
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
      helpfulAnswers: answersRated(true),
      unhelpfulAnswers: answersRated(false),
    })
    .from(chatTraces)
    .groupBy(chatTraces.sessionId)
    .having(FEEDBACK_FILTERS[filter])
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
