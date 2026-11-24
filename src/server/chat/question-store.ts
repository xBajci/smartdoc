import { and, asc, count, eq, gt, isNotNull } from 'drizzle-orm'
import type { ModelCall } from '../../ai/types'
import { getDatabase } from '../../db/client'
import { chatTraces } from '../../db/schema'
import { storeCalls } from '../ai/calls'
import type { EarlierTrace } from './history'

/** How much of a question names it in the records of AI calls. */
const TITLE_CHARACTERS = 80

/** What is written of one question: its trace, as `chat_traces` holds it. */
export type KeptQuestion = Required<
  Pick<
    typeof chatTraces.$inferInsert,
    | 'id'
    | 'conversationId'
    | 'question'
    | 'history'
    | 'answer'
    | 'error'
    | 'scope'
    | 'model'
    | 'steps'
    | 'messages'
    | 'setup'
    | 'durationMs'
    | 'costUsd'
    | 'askerHash'
    | 'mlflowTraceId'
  >
>

/**
 * What answering a question reads and writes of the questions asked so far.
 * The application keeps them in Postgres; the tests of a question keep them in memory.
 */
export interface QuestionStore {
  /** How many questions visitors asked since a time; with `askerHash`, only those of one visitor. */
  askedSince(since: Date, askerHash?: string): Promise<number>
  /** The earlier questions of a conversation, oldest first; empty when no question has the id. */
  earlier(conversationId: string): Promise<EarlierTrace[]>
  /** Writes the trace of a question and the calls to models it made. */
  keep(question: KeptQuestion, calls: readonly ModelCall[]): Promise<void>
}

/** The questions as the application keeps them: in `chat_traces`, their calls in `ai_usage`. */
export const postgresStore: QuestionStore = {
  async askedSince(since, askerHash) {
    const [row] = await getDatabase()
      .select({ total: count() })
      .from(chatTraces)
      .where(
        and(
          // The administrator's questions carry no hash and count for no limit.
          askerHash === undefined
            ? isNotNull(chatTraces.askerHash)
            : eq(chatTraces.askerHash, askerHash),
          gt(chatTraces.createdAt, since),
        ),
      )
    return row?.total ?? 0
  },

  earlier(conversationId) {
    return getDatabase()
      .select({
        question: chatTraces.question,
        answer: chatTraces.answer,
        error: chatTraces.error,
        steps: chatTraces.steps,
        messages: chatTraces.messages,
      })
      .from(chatTraces)
      .where(eq(chatTraces.conversationId, conversationId))
      .orderBy(asc(chatTraces.createdAt))
  },

  async keep(question, calls) {
    await getDatabase().insert(chatTraces).values(question)
    // The trace is what the visitor's answer stands on; the records of its calls must not fail it.
    await storeCalls(
      {
        runId: question.id,
        documentId: null,
        title: `Chat: ${question.question.slice(0, TITLE_CHARACTERS)}`,
        format: null,
      },
      calls,
    ).catch((caught: unknown) => console.error('Chat usage was not recorded:', caught))
  },
}
