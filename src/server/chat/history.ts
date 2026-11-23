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
 * The conversation as the debugger shows it: every earlier question with its
 * answer, oldest first. A question that failed or got no answer is left out;
 * the visitor was told so and the model never sees a one-sided exchange. A
 * long text is cut here only; the model gets the messages whole.
 */
export function historyFromTraces(traces: readonly AnsweredTrace[]): ChatTurn[] {
  return traces.filter(isAnswered).flatMap((trace): ChatTurn[] => [
    { role: 'visitor', text: trace.question.slice(0, MAX_TURN_CHARACTERS) },
    { role: 'archive', text: trace.answer.slice(0, MAX_TURN_CHARACTERS) },
  ])
}

const isAnswered = (trace: AnsweredTrace) => trace.error === null && trace.answer !== ''

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
   * The messages of the chat model: the summary, if there is one, then every
   * question after it with its searches and everything the model wrote,
   * exactly as it was sent then. So each question starts the way the one
   * before it ended, and the provider serves that start from its cache.
   */
  messages: ModelMessage[]
  /** For the rewrite model, which has no tools: each question, the passages it found and its answer, as text. */
  forRewrite: ChatTurn[]
  /** Passages the questions after the summary found; the new answer may cite them. */
  passages: ChatPassage[]
  /** The number of the next passage: the numbers run on through the whole session, so no two passages share one. */
  firstNumber: number
  /** Questions the history stands for, those in the summary included. */
  questions: number
  /** Input tokens of the last model call of the last answered question: how far the prompt has grown. */
  promptTokens: number
}

export const NO_HISTORY: SessionHistory = {
  turns: [],
  messages: [],
  forRewrite: [],
  passages: [],
  firstNumber: 1,
  questions: 0,
  promptTokens: 0,
}

/** Starts the summary wherever the models are told it, in place of the questions it stands for. */
export const SUMMARY_LEAD = 'Shrnutí dřívější části rozhovoru:'

const passagesOf = (trace: EarlierTrace) =>
  trace.steps.flatMap((step) => (step.kind === 'search' ? step.passages : []))

/** The newest summary that went well, and the trace whose question made it. */
function newestSummary(traces: readonly EarlierTrace[]) {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const summary = traces[index]?.steps.find(
      (step) => step.kind === 'summary' && step.error === null,
    )
    if (summary?.kind === 'summary') return { index, summary }
  }
  return null
}

const summaryTurn = (text: string): ChatTurn => ({
  role: 'visitor',
  text: `${SUMMARY_LEAD}\n${text}`,
})

/**
 * The history of a session from its earlier questions, oldest first. The
 * newest summary stands for every question before the one that made it; the
 * questions from that one on come whole. A failed question is left out.
 */
export function sessionHistory(traces: readonly EarlierTrace[]): SessionHistory {
  const newest = newestSummary(traces)
  const since = newest === null ? traces : traces.slice(newest.index)
  const kept = since.filter(isAnswered)
  const lead = newest === null ? [] : [summaryTurn(newest.summary.text)]
  const numbers = traces.flatMap((trace) => passagesOf(trace).map((passage) => passage.number))
  const last = kept.at(-1)
  return {
    turns: [...lead, ...historyFromTraces(since)],
    messages: [
      ...turnsAsMessages(lead),
      ...kept.flatMap(
        (trace) =>
          trace.messages ??
          turnsAsMessages([
            { role: 'visitor', text: trace.question },
            { role: 'archive', text: trace.answer },
          ]),
      ),
    ],
    forRewrite: [
      ...lead,
      ...kept.flatMap((trace): ChatTurn[] => {
        const passages = passagesOf(trace)
        const found =
          passages.length === 0 ? '' : `Nalezené úryvky:\n${passagesForModel(passages)}\n\n`
        return [
          { role: 'visitor', text: trace.question },
          { role: 'archive', text: `${found}Odpověď: ${trace.answer}` },
        ]
      }),
    ],
    passages: kept.flatMap(passagesOf),
    firstNumber: Math.max(0, ...numbers) + 1,
    questions: (newest?.summary.questions ?? 0) + kept.length,
    promptTokens: Math.max(
      0,
      ...(last?.steps ?? []).map((step) => (step.kind === 'model' ? step.inputTokens : 0)),
    ),
  }
}

/**
 * The history once it is summed up: the summary stands for all of it, the
 * passages before it can no longer be cited, and the numbers go on.
 */
export function summarized(history: SessionHistory, text: string): SessionHistory {
  const lead = summaryTurn(text)
  return {
    turns: [lead],
    messages: turnsAsMessages([lead]),
    forRewrite: [lead],
    passages: [],
    firstNumber: history.firstNumber,
    questions: history.questions,
    promptTokens: 0,
  }
}
