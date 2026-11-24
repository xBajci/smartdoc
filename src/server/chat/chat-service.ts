import { and, asc, count, desc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm'
import type {
  ChatFeedbackFilter,
  ChatSessionSummary,
  ChatTrace,
  ChatTraceStep,
  ChatTraceSummary,
} from '../../archive/types'
import { getDatabase } from '../../db/client'
import { chatTraces } from '../../db/schema'
import { sendFeedback, type Feedback } from './mlflow'

// What happens to a question after it was answered: the visitor's word about
// the answer, and the lists the debugger reads. Asking is in `question.ts`.

const RECENT_SESSIONS = 100

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
