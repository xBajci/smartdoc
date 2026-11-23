import { MockLanguageModelV4 } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTraceStep } from '../../archive/types'
import { getAnswerer } from './answerer'
import {
  CALCULATION_TOOL,
  CALCULATIONS_USED_UP,
  SEARCH_TOOL,
  SEARCHES_USED_UP,
} from './instructions'
import type { SearchStep } from './retrieval'
import { chatSettings } from './settings'

// The limits of the chat are kept by the loop around a real model, which no E2E
// test runs: there the fake model answers. So a scripted model plays it here.
const scripted = vi.hoisted(() => ({ model: undefined as unknown }))
vi.mock('../ai/models', async (original) => ({
  ...(await original<typeof import('../ai/models')>()),
  languageModel: () => scripted.model,
  modelName: () => 'openai:test',
  modelSetting: () => ({ provider: 'openai', model: 'test' }),
}))

/** The input of a tool call, or its raw JSON text when the test needs one no object can give. */
type Call = { tool: string; input: Record<string, unknown> | string }
/** What the model does in one step: call tools, or answer. */
type Reply = Call[] | string

let usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

const calculate = (skript: string): Call => ({
  tool: CALCULATION_TOOL,
  input: { skript, parametry: { castky: [870000, 240000] } },
})
const search = (dotaz: string): Call => ({ tool: SEARCH_TOOL, input: { dotaz } })
const GOOD = 'return parametry.castky[0] + parametry.castky[1]'
const BROKEN = 'return (parametry.castky[0] +'

/** The tools each step offered the model, and whether it had to use one. */
let offered: { tools: string[]; choice: string | undefined }[]
/** What each step asked the provider for, besides the prompt. */
let providerOptions: unknown[]
/** The roles of the messages each step sent. */
let roles: string[][]
/** What each tool told the model, in the order the model got it. */
let results: string[]
/** The messages the answer gave back for the next question. */
let kept: { role: string }[]
let steps: ChatTraceStep[]

async function answer(replies: Reply[], limits: Partial<ReturnType<typeof chatSettings>> = {}) {
  scripted.model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      offered.push({
        tools: (options.tools ?? []).map((tool) => tool.name),
        choice: options.toolChoice?.type,
      })
      providerOptions.push(options.providerOptions)
      roles.push(options.prompt.map((message) => message.role))
      results = options.prompt.flatMap((message) =>
        message.role === 'tool'
          ? message.content.flatMap((part) =>
              part.type === 'tool-result' && part.output.type === 'text' ? [part.output.value] : [],
            )
          : [],
      )
      const reply = replies.shift() ?? 'Hotovo.'
      if (typeof reply === 'string') {
        return {
          content: [{ type: 'text', text: reply }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
          warnings: [],
        }
      }
      return {
        content: reply.map((call, index) => ({
          type: 'tool-call',
          toolCallId: `volani-${offered.length}-${index}`,
          toolName: call.tool,
          input: typeof call.input === 'string' ? call.input : JSON.stringify(call.input),
        })),
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage,
        warnings: [],
      }
    },
  })
  const answered = await getAnswerer()({
    question: 'Kolik obec dá celkem?',
    instructions: 'Jsi asistent archivu.',
    history: [],
    settings: {
      ...chatSettings(),
      maxSearches: 2,
      maxCalculations: 2,
      maxErroredRuns: 2,
      ...limits,
    },
    found: [found('osvětlení dotace spolkům')],
    search: async (query) => found(query),
    trace: (step) => steps.push(step),
  })
  kept = answered.messages
  return answered.text
}

/** A search that finds the one passage with both amounts. */
const found = (query: string): SearchStep => ({
  kind: 'search',
  query,
  durationMs: 0,
  embeddingTokens: 0,
  words: [],
  meaning: [],
  passages: [
    {
      number: 1,
      chunkId: 1,
      documentId: 'zapis',
      documentTitle: 'Zápis',
      page: 2,
      text: 'Osvětlení za 870 000 Kč, dotace spolkům 240 000 Kč.',
      wordRank: 1,
      meaningRank: 1,
      fusedScore: 1,
    },
  ],
})

const calculations = () => steps.flatMap((step) => (step.kind === 'calculation' ? [step] : []))

describe('the chat model and its calculations', () => {
  beforeEach(() => {
    offered = []
    providerOptions = []
    roles = []
    results = []
    kept = []
    steps = []
    usage = { ...usage, inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 } }
    delete process.env.AI_PRICES
  })

  it('asks every provider to cache the prompt and prices what came from the cache lower', async () => {
    process.env.AI_PRICES = '{"openai:test":[1,2,0.1]}'
    usage = {
      ...usage,
      inputTokens: { total: 1_000_000, noCache: 200_000, cacheRead: 800_000, cacheWrite: 0 },
    }
    await answer(['Hotovo.'])
    expect(providerOptions[0]).toEqual({
      openai: { promptCacheKey: 'hm-archiv-chat' },
      anthropic: { cacheControl: { type: 'ephemeral' } },
    })
    const model = steps.find((step) => step.kind === 'model')
    // 200k uncached at 1, 800k from the cache at 0.1, 5 output tokens at 2.
    expect(model).toMatchObject({ inputTokens: 1_000_000, cachedInputTokens: 800_000 })
    expect(model?.kind === 'model' && model.costUsd).toBeCloseTo(0.2 + 0.08 + 0.00001)
  })

  it('starts with the passages of the first search and may calculate at once', async () => {
    await answer([[calculate(GOOD)], 'Celkem 1 110 000 Kč [1].'])
    // The first search comes as the model's own call of the search tool and what it found.
    expect(roles[0]).toEqual(['system', 'user', 'assistant', 'tool'])
    // Both steps offer the same tools, so the provider can serve the second from its cache.
    expect(offered[0]).toEqual({ tools: [SEARCH_TOOL, CALCULATION_TOOL], choice: 'auto' })
    expect(offered[1]).toEqual({ tools: [SEARCH_TOOL, CALCULATION_TOOL], choice: 'auto' })
    expect(calculations()).toMatchObject([{ result: '1110000', error: null, ran: true }])
  })

  it('does not count a script that failed, so the model can fix it', async () => {
    const text = await answer([
      [calculate(BROKEN)],
      [calculate(GOOD)],
      [calculate(GOOD)],
      'Celkem 1 110 000 Kč [1].',
    ])
    expect(calculations().map((step) => step.error === null)).toEqual([false, true, true])
    expect(calculations()[0]?.error).toMatch(/^SyntaxError: /)
    expect(text).toBe('Celkem 1 110 000 Kč [1].')
  })

  it('gives back the question, the first search and all it wrote, for the next question', async () => {
    await answer([[calculate(GOOD)], 'Celkem 1 110 000 Kč [1].'])
    // The question, the first search (call and result), the calculation (call and result), the answer.
    expect(kept.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ])
  })

  it('never changes the tools; a used-up tool says so when called', async () => {
    await answer([[calculate(GOOD)], [calculate(GOOD)], [calculate(GOOD)], 'Hotovo.'])
    expect(
      offered.every((step) => step.tools.join() === `${SEARCH_TOOL},${CALCULATION_TOOL}`),
    ).toBe(true)
    expect(calculations().map((step) => step.ran)).toEqual([true, true, false])
    expect(calculations()[2]?.error).toBe(CALCULATIONS_USED_UP)
  })

  it('ends the calculating after as many failed scripts as the limit allows', async () => {
    await answer([
      [calculate(BROKEN)],
      [calculate(BROKEN)],
      [calculate(GOOD)],
      'Nespočítal jsem to.',
    ])
    expect(calculations().map((step) => step.ran)).toEqual([true, true, false])
    expect(calculations()[2]?.error).toBe(CALCULATIONS_USED_UP)
  })

  it('refuses a search after the searches are used up, and the trace says so', async () => {
    // The first search used up the only search.
    await answer([[search('rozpočet 2025')], 'Hotovo.'], { maxSearches: 1 })
    expect(results.at(-1)).toBe(SEARCHES_USED_UP)
    expect(steps.filter((step) => step.kind === 'search')).toHaveLength(0)
    const model = steps.find((step) => step.kind === 'model' && step.step === 1)
    expect(model).toMatchObject({ searches: [], refusedSearches: ['rozpočet 2025'] })
  })

  it('makes the model answer in the last step, however many calls it wasted', async () => {
    const limits = { maxSearches: 1, maxCalculations: 1, maxErroredRuns: 1 }
    // The scripted model calls a tool whenever it is told to; a real one answers when it may not.
    const text = await answer(
      [...Array.from({ length: 5 }, () => [search('znovu')]), 'Hotovo.'],
      limits,
    )
    // Three limits, one more step, and two for refused calls: the sixth step must answer.
    expect(offered).toHaveLength(6)
    expect(offered[5]?.choice).toBe('none')
    expect(offered[4]?.choice).toBe('auto')
    expect(text).toBe('Hotovo.')
  })

  it('runs only as many of the calculations asked for at once as the limit allows', async () => {
    const many = Array.from({ length: 20 }, () => calculate(GOOD))
    await answer([many, 'Hotovo.'])
    const ran = calculations().filter((step) => step.ran)
    const refused = calculations().filter((step) => !step.ran)
    expect(ran).toHaveLength(2)
    expect(refused).toHaveLength(18)
    expect(refused.every((step) => step.error === CALCULATIONS_USED_UP)).toBe(true)
    const model = steps.find((step) => step.kind === 'model' && step.step === 1)
    expect(model).toMatchObject({ calculations: 20, searches: [] })
  })

  it('makes the model answer when nothing is left to use', async () => {
    // The first search used up the only search.
    await answer([[calculate(GOOD)], 'Hotovo.'], { maxSearches: 1, maxCalculations: 1 })
    expect(offered[1]).toEqual({ tools: [SEARCH_TOOL, CALCULATION_TOOL], choice: 'none' })
  })

  it('parameters nested deep reach the script as text, and the next calculation runs', async () => {
    // Copied to the worker as an object, this depth could overflow the stack; as JSON text it cannot.
    const depth = 2000
    const deep = `{"skript":"return 1","parametry":${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}}`
    await answer([[{ tool: CALCULATION_TOOL, input: deep }], [calculate(GOOD)], 'Hotovo.'])
    expect(calculations().map((step) => [step.ran, step.result])).toEqual([
      [true, '1'],
      [true, '1110000'],
    ])
  })
})
