import type { ChatTurn } from '../../archive/types'
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
