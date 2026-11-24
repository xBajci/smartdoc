import { generateText } from 'ai'
import type { ChatTraceStep, ChatTurn } from '../../chat/types'
import { FAKE_USAGE, reasonOf, spent, unspent } from '../ai/calls'
import { languageModel, modelName, modelSetting } from '../ai/models'
import { chatTelemetry } from './mlflow'

export type SummaryStep = Extract<ChatTraceStep, { kind: 'summary' }>

export interface SummaryInput {
  /** The conversation as the rewrite model reads it: questions, passages and answers, as text. */
  turns: readonly ChatTurn[]
  /** How many questions the turns stand for, an earlier summary included. */
  questions: number
  /** The skills of the place `chat-summary`, put together. */
  instructions: string
}

/**
 * Sums up a conversation that grew too long. It never fails: when the model
 * gives no summary, the step says why and the whole history is sent.
 */
export type Summarizer = (input: SummaryInput) => Promise<SummaryStep>

/** The conversation as one text, for a model that reads it, not one that continues it. */
export function conversationText(turns: readonly ChatTurn[]): string {
  return turns
    .map((turn) => `${turn.role === 'visitor' ? 'Návštěvník' : 'Archiv'}: ${turn.text}`)
    .join('\n\n')
}

const aiSummarizer: Summarizer = async ({ turns, questions, instructions }) => {
  const model = modelName('summary')
  const started = Date.now()
  try {
    const { text, usage } = await generateText({
      model: languageModel('summary'),
      telemetry: chatTelemetry(),
      instructions,
      messages: [{ role: 'user', content: conversationText(turns) }],
    })
    if (text.trim() === '') throw new Error('The summary model gave an empty text.')
    return {
      kind: 'summary',
      model,
      text: text.trim(),
      questions,
      error: null,
      durationMs: Date.now() - started,
      ...spent(model, usage),
    }
  } catch (caught) {
    return {
      kind: 'summary',
      model,
      text: '',
      questions,
      error: reasonOf(caught),
      durationMs: Date.now() - started,
      ...unspent(model),
    }
  }
}

/** A stand-in for the test suite (`AI_SUMMARY_MODEL=fake:summary`): it lists the questions. */
const fakeSummarizer: Summarizer = ({ turns, questions }) => {
  const model = modelName('summary')
  const asked = turns.filter((turn) => turn.role === 'visitor').map((turn) => turn.text)
  return Promise.resolve({
    kind: 'summary',
    model,
    text: `Návštěvník se ptal: ${asked.join(' | ')}`,
    questions,
    error: null,
    durationMs: 1,
    ...spent(model, FAKE_USAGE),
  })
}

export function getSummarizer(): Summarizer {
  return modelSetting('summary').provider === 'fake' ? fakeSummarizer : aiSummarizer
}
