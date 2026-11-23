import { generateText, Output } from 'ai'
import { z } from 'zod'
import type { ChatTraceStep, ChatTurn } from '../../archive/types'
import { languageModel, modelName, modelSetting } from '../ai/models'
import { costOfCall } from '../ai/prices'
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
    const inputTokens = usage.inputTokens ?? 0
    const outputTokens = usage.outputTokens ?? 0
    const cached = {
      read: usage.inputTokenDetails.cacheReadTokens ?? 0,
      written: usage.inputTokenDetails.cacheWriteTokens ?? 0,
    }
    return {
      kind: 'rewrite',
      model,
      queries: firstQueries(output.dotazy, question, history),
      error: null,
      durationMs: Date.now() - started,
      inputTokens,
      cachedInputTokens: cached.read,
      outputTokens,
      costUsd: costOfCall(model, inputTokens, outputTokens, cached),
    }
  } catch (caught) {
    return {
      kind: 'rewrite',
      model,
      queries: [question],
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

/** A stand-in for the test suite (`AI_REWRITE_MODEL=fake:rewrite`): it searches with the question as it is. */
const fakeRewriter: Rewriter = ({ question, history }) => {
  const model = modelName('rewrite')
  return Promise.resolve({
    kind: 'rewrite',
    model,
    queries: firstQueries([question], question, history),
    error: null,
    durationMs: 1,
    ...FAKE_USAGE,
    costUsd: costOfCall(model, FAKE_USAGE.inputTokens, FAKE_USAGE.outputTokens),
  })
}

export function getRewriter(): Rewriter {
  return modelSetting('rewrite').provider === 'fake' ? fakeRewriter : aiRewriter
}
