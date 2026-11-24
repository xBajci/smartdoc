import { generateText, Output } from 'ai'
import { z } from 'zod'
import type { ChatTraceStep, ChatTurn } from '../../archive/types'
import { FAKE_USAGE, reasonOf, spent, unspent } from '../ai/calls'
import { languageModel, modelName, modelSetting } from '../ai/models'
import { turnsAsMessages } from './history'
import { chatTelemetry } from './mlflow'

export type RewriteStep = Extract<ChatTraceStep, { kind: 'rewrite' }>

export interface RewriteInput {
  question: string
  history: readonly ChatTurn[]
  /** The skills of the place `chat-rewrite`, put together: the rules of searching and the glossary. */
  instructions: string
}

/**
 * Writes the queries of the first search of a question. It never fails: when
 * the model gives nothing usable, the question itself is searched, and the
 * step says why.
 */
export type Rewriter = (input: RewriteInput) => Promise<RewriteStep>

/** The most queries of the first search; more would only fill the input of the chat model. */
export const MAX_FIRST_QUERIES = 3

/**
 * The queries as they are searched: trimmed, each once, at most three. With no
 * conversation behind it the question has nothing to be answered from, so an
 * empty list becomes the question itself.
 */
export function firstQueries(
  queries: readonly string[],
  question: string,
  history: readonly ChatTurn[],
): string[] {
  const kept = [...new Set(queries.map((query) => query.trim()).filter((query) => query !== ''))]
  if (kept.length === 0 && history.length === 0) return [question]
  return kept.slice(0, MAX_FIRST_QUERIES)
}

const aiRewriter: Rewriter = async ({ question, history, instructions }) => {
  const model = modelName('rewrite')
  const started = Date.now()
  try {
    const { output, usage } = await generateText({
      model: languageModel('rewrite'),
      telemetry: chatTelemetry(),
      // The rules and the glossary are the same for every question, so they stay in the cache.
      providerOptions: {
        openai: { promptCacheKey: 'hm-archiv-rewrite' },
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
      instructions,
      messages: [...turnsAsMessages(history), { role: 'user', content: question }],
      output: Output.object({
        schema: z.object({
          dotazy: z
            .array(z.string())
            .describe('Jeden až tři dotazy pro hledání v archivu; prázdné, když hledat netřeba.'),
        }),
      }),
    })
    return {
      kind: 'rewrite',
      model,
      queries: firstQueries(output.dotazy, question, history),
      error: null,
      durationMs: Date.now() - started,
      ...spent(model, usage),
    }
  } catch (caught) {
    return {
      kind: 'rewrite',
      model,
      queries: [question],
      error: reasonOf(caught),
      durationMs: Date.now() - started,
      ...unspent(model),
    }
  }
}

/** A stand-in for the test suite (`AI_REWRITE_MODEL=fake:rewrite`): it searches with the question as it is. */
const fakeRewriter: Rewriter = ({ question, history }) => {
  const model = modelName('rewrite')
  return Promise.resolve({
    kind: 'rewrite',
    model,
    queries: firstQueries([question], question, history),
    error: null,
    durationMs: 1,
    ...spent(model, FAKE_USAGE),
  })
}

export function getRewriter(): Rewriter {
  return modelSetting('rewrite').provider === 'fake' ? fakeRewriter : aiRewriter
}
