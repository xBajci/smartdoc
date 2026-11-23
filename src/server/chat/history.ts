import type { ModelMessage } from 'ai'
import type { ChatPassage, ChatTraceStep, ChatTurn } from '../../archive/types'
import { passagesForModel } from './retrieval'
import { MAX_TURN_CHARACTERS } from './settings'

/** What of an earlier trace of the session the history is made from. */
export interface AnsweredTrace {
  question: string
  answer: string
  error: string | null
}

/**
 * The conversation as the model is told it: every earlier question of the
 * session with its answer, oldest first, cut to the last `historyMessages`
 * turns. A question that failed or got no answer is left out; the visitor
 * was told so and the model should not see a one-sided exchange. A long
 * answer is cut, so a session cannot grow what every later question costs.
 */
export function historyFromTraces(
  traces: readonly AnsweredTrace[],
  historyMessages: number,
): ChatTurn[] {
  return traces
    .filter((trace) => trace.error === null && trace.answer !== '')
    .flatMap((trace): ChatTurn[] => [
      { role: 'visitor', text: trace.question.slice(0, MAX_TURN_CHARACTERS) },
      { role: 'archive', text: trace.answer.slice(0, MAX_TURN_CHARACTERS) },
    ])
    .slice(-historyMessages)
}

/** The conversation as messages of a model: the visitor is the user, the archive the assistant. */
export function turnsAsMessages(turns: readonly ChatTurn[]): ModelMessage[] {
  return turns.map((turn) => ({
    role: turn.role === 'visitor' ? ('user' as const) : ('assistant' as const),
    content: turn.text,
  }))
}

/** An earlier question of the session, with what the history needs of it. */
export interface EarlierTrace extends AnsweredTrace {
  steps: readonly ChatTraceStep[]
  /** `null` in traces older than the messages. */
  messages: readonly ModelMessage[] | null
}

/** What the next question of a session is told of the earlier ones. */
export interface SessionHistory {
  /** Questions and answers, as the debugger shows them. */
  turns: ChatTurn[]
  /**
   * The messages of the chat model: every earlier question with its searches
   * and everything the model wrote, exactly as it was sent then. So each
   * question starts the way the one before it ended, and the provider serves
   * that start from its cache.
   */
  messages: ModelMessage[]
  /** For the rewrite model, which has no tools: each question, the passages it found and its answer, as text. */
  forRewrite: ChatTurn[]
  /** Passages the earlier questions found; the new answer may cite them. */
  passages: ChatPassage[]
  /** The number of the next passage: the numbers run on through the whole session, so no two passages share one. */
  firstNumber: number
}

export const NO_HISTORY: SessionHistory = {
  turns: [],
  messages: [],
  forRewrite: [],
  passages: [],
  firstNumber: 1,
}

const passagesOf = (trace: EarlierTrace) =>
  trace.steps.flatMap((step) => (step.kind === 'search' ? step.passages : []))

/**
 * The history of a session from its earlier questions, oldest first. As with
 * the turns, a failed question is left out and only the last
 * `historyMessages` turns, i.e. half as many questions, are kept.
 */
export function sessionHistory(
  traces: readonly EarlierTrace[],
  historyMessages: number,
): SessionHistory {
  const kept = traces
    .filter((trace) => trace.error === null && trace.answer !== '')
    .slice(-Math.floor(historyMessages / 2))
  const numbers = traces.flatMap((trace) => passagesOf(trace).map((passage) => passage.number))
  return {
    turns: historyFromTraces(traces, historyMessages),
    messages: kept.flatMap(
      (trace) =>
        trace.messages ??
        turnsAsMessages([
          { role: 'visitor', text: trace.question },
          { role: 'archive', text: trace.answer },
        ]),
    ),
    forRewrite: kept.flatMap((trace): ChatTurn[] => {
      const passages = passagesOf(trace)
      const found =
        passages.length === 0 ? '' : `Nalezené úryvky:\n${passagesForModel(passages)}\n\n`
      return [
        { role: 'visitor', text: trace.question },
        { role: 'archive', text: `${found}Odpověď: ${trace.answer}` },
      ]
    }),
    passages: kept.flatMap(passagesOf),
    firstNumber: Math.max(0, ...numbers) + 1,
  }
}
