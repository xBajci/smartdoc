import type { ModelCall } from '../../ai/types'
import type { ChatTraceStep } from '../../chat/types'
import { spent } from '../ai/calls'
import type { Instructions, SkillUse } from '../ai/skills/types'

/** What the calls of one place were told, with the place they were made at. */
export interface Told extends Instructions {
  use: SkillUse
}

/** What is known of a question besides its steps, for the records of its calls. */
export interface CallsContext {
  question: string
  /** The model that embedded the queries; a search step does not say it. */
  embeddingModel: string
  summary: Told
  rewrite: Told
  answer: Told
  rerank: Told
}

/** What a model step that wrote no text asked for, as the records show it. */
function toolsAskedFor(step: Extract<ChatTraceStep, { kind: 'model' }>): string {
  const asked = step.searches.length === 0 ? [] : [`Hledat: ${step.searches.join(' | ')}`]
  if ((step.calculations ?? 0) > 0) asked.push(`Spočítat: ${step.calculations}×`)
  return asked.join(', ')
}

/**
 * The calls to models that the steps of a question stand for, in the order
 * they were made. The steps are what happened; this only says it again the way
 * the records of AI calls keep every call. A search is up to three calls: the
 * embedding of the query, the weighing of the branches and the reranking.
 */
export function callsOfSteps(steps: readonly ChatTraceStep[], context: CallsContext): ModelCall[] {
  const told = (place: Told) => ({ use: place.use, skills: place.skills, page: null })
  const untold = { use: null, skills: null, page: null }
  return steps.flatMap((step): ModelCall[] => {
    if (step.kind === 'summary') {
      return [
        {
          operation: 'summary-chat',
          ...told(context.summary),
          model: step.model,
          input: `Otázek: ${step.questions}`,
          output: step.text,
          error: step.error,
          durationMs: step.durationMs,
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
          costUsd: step.costUsd,
        },
      ]
    }
    if (step.kind === 'rewrite') {
      return [
        {
          operation: 'rewrite',
          ...told(context.rewrite),
          model: step.model,
          input: context.question,
          output: step.queries.join(' | '),
          error: step.error,
          durationMs: step.durationMs,
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
          costUsd: step.costUsd,
        },
      ]
    }
    if (step.kind === 'model') {
      return [
        {
          operation: 'chat',
          ...told(context.answer),
          model: step.model,
          input: step.step === 1 ? context.question : 'Výsledky nástrojů z předchozího kroku.',
          output: step.text === '' ? toolsAskedFor(step) : step.text,
          error: null,
          durationMs: step.durationMs,
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
          costUsd: step.costUsd,
        },
      ]
    }
    // A calculation runs here, in the sandbox, and costs nothing.
    if (step.kind === 'calculation') return []
    const { weights, rerank } = step
    const embedded = spent(context.embeddingModel, {
      inputTokens: step.embeddingTokens,
      outputTokens: 0,
    })
    const calls: ModelCall[] = [
      {
        operation: 'embed',
        ...untold,
        model: context.embeddingModel,
        input: step.query,
        output: `Úryvků: ${step.passages.length}`,
        error: null,
        // The weighing runs beside the branches; the reranking after them.
        durationMs: Math.max(0, step.durationMs - (rerank?.durationMs ?? 0)),
        inputTokens: embedded.inputTokens,
        outputTokens: embedded.outputTokens,
        costUsd: embedded.costUsd,
      },
    ]
    if (weights !== undefined) {
      calls.push({
        operation: 'weigh',
        ...untold,
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
        ...told(context.rerank),
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
}
