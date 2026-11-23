import { generateText } from 'ai'
import type { ChatTraceStep, ChatTurn } from '../../archive/types'
import { languageModel, modelName, modelSetting } from '../ai/models'
import { costOfCall } from '../ai/prices'
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
    const inputTokens = usage.inputTokens ?? 0
    const outputTokens = usage.outputTokens ?? 0
    const cached = {
      read: usage.inputTokenDetails.cacheReadTokens ?? 0,
      written: usage.inputTokenDetails.cacheWriteTokens ?? 0,
    }
    return {
      kind: 'summary',
      model,
      text: text.trim(),
      questions,
      error: null,
      durationMs: Date.now() - started,
      inputTokens,
      cachedInputTokens: cached.read,
      outputTokens,
      costUsd: costOfCall(model, inputTokens, outputTokens, cached),
    }
  } catch (caught) {
    return {
      kind: 'summary',
      model,
      text: '',
      questions,
      error: caught instanceof Error ? caught.message : String(caught),
      durationMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    }
  }
}

/** Tokens the fake model reports, so costs in tests are fixed. */
const FAKE_USAGE = { inputTokens: 1000, outputTokens: 100 }

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
    ...FAKE_USAGE,
    costUsd: costOfCall(model, FAKE_USAGE.inputTokens, FAKE_USAGE.outputTokens),
  })
}

export function getSummarizer(): Summarizer {
  return modelSetting('summary').provider === 'fake' ? fakeSummarizer : aiSummarizer
}
