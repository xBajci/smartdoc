import { MockLanguageModelV4 } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTraceStep } from '../../archive/types'
import { getAnswerer } from './answerer'
import { CALCULATION_TOOL, CALCULATIONS_USED_UP, SEARCH_TOOL } from './instructions'
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

const search = (dotaz = 'rozpočet'): Call => ({ tool: SEARCH_TOOL, input: { dotaz } })
const calculate = (skript: string): Call => ({
  tool: CALCULATION_TOOL,
  input: { skript, parametry: { castky: [870000, 240000] } },
})
const GOOD = 'return parametry.castky[0] + parametry.castky[1]'
const BROKEN = 'return (parametry.castky[0] +'

/** The tools each step offered the model, and whether it had to use one. */
let offered: { tools: string[]; choice: string | undefined }[]
/** What each step asked the provider for, besides the prompt. */
let providerOptions: unknown[]
let steps: ChatTraceStep[]

async function answer(replies: Reply[], limits: Partial<ReturnType<typeof chatSettings>> = {}) {
  scripted.model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      offered.push({
        tools: (options.tools ?? []).map((tool) => tool.name),
        choice: options.toolChoice?.type,
      })
      providerOptions.push(options.providerOptions)
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
  return getAnswerer()({
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
    search: async (query): Promise<SearchStep> => ({
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
    }),
    trace: (step) => steps.push(step),
  })
}

const calculations = () => steps.flatMap((step) => (step.kind === 'calculation' ? [step] : []))

describe('the chat model and its calculations', () => {
  beforeEach(() => {
    offered = []
    providerOptions = []
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
    await answer([[search()], 'Hotovo.'])
    expect(providerOptions[0]).toEqual({
      openai: { promptCacheKey: 'hm-archiv-chat' },
      anthropic: { cacheControl: { type: 'ephemeral' } },
    })
    const model = steps.find((step) => step.kind === 'model')
    // 200k uncached at 1, 800k from the cache at 0.1, 5 output tokens at 2.
    expect(model).toMatchObject({ inputTokens: 1_000_000, cachedInputTokens: 800_000 })
    expect(model?.kind === 'model' && model.costUsd).toBeCloseTo(0.2 + 0.08 + 0.00001)
  })

  it('must search first and only then may calculate', async () => {
    await answer([[search()], [calculate(GOOD)], 'Celkem 1 110 000 Kč [1].'])
    // Both steps offer the same tools, so the provider can serve the second from its cache.
    expect(offered[0]).toEqual({ tools: [SEARCH_TOOL, CALCULATION_TOOL], choice: 'tool' })
    expect(offered[1]).toEqual({ tools: [SEARCH_TOOL, CALCULATION_TOOL], choice: 'auto' })
    expect(calculations()).toMatchObject([{ result: '1110000', error: null, ran: true }])
  })

  it('does not count a script that failed, so the model can fix it', async () => {
    const text = await answer([
      [search()],
      [calculate(BROKEN)],
      [calculate(GOOD)],
      [calculate(GOOD)],
      'Celkem 1 110 000 Kč [1].',
    ])
    expect(calculations().map((step) => step.error === null)).toEqual([false, true, true])
    expect(calculations()[0]?.error).toMatch(/^SyntaxError: /)
    // After the error and one calculation the tool is still there; after two calculations it is not.
    expect(offered[3]?.tools).toContain(CALCULATION_TOOL)
    expect(offered[4]?.tools).not.toContain(CALCULATION_TOOL)
    expect(text).toBe('Celkem 1 110 000 Kč [1].')
  })

  it('ends the calculating after as many failed scripts as the limit allows', async () => {
    await answer([[search()], [calculate(BROKEN)], [calculate(BROKEN)], 'Nespočítal jsem to.'])
    expect(offered[2]?.tools).toContain(CALCULATION_TOOL)
    expect(offered[3]?.tools).not.toContain(CALCULATION_TOOL)
  })

  it('runs only as many of the calculations asked for at once as the limit allows', async () => {
    const many = Array.from({ length: 20 }, () => calculate(GOOD))
    await answer([[search()], many, 'Hotovo.'])
    const ran = calculations().filter((step) => step.ran)
    const refused = calculations().filter((step) => !step.ran)
    expect(ran).toHaveLength(2)
    expect(refused).toHaveLength(18)
    expect(refused.every((step) => step.error === CALCULATIONS_USED_UP)).toBe(true)
    const model = steps.find((step) => step.kind === 'model' && step.step === 2)
    expect(model).toMatchObject({ calculations: 20, searches: [] })
  })

  it('makes the model answer when nothing is left to use', async () => {
    await answer([[search()], [calculate(GOOD)], 'Hotovo.'], {
      maxSearches: 1,
      maxCalculations: 1,
    })
    expect(offered[2]).toEqual({ tools: [SEARCH_TOOL, CALCULATION_TOOL], choice: 'none' })
  })

  it('parameters nested deep reach the script as text, and the next calculation runs', async () => {
    // Copied to the worker as an object, this depth could overflow the stack; as JSON text it cannot.
    const depth = 2000
    const deep = `{"skript":"return 1","parametry":${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}}`
    await answer([
      [search()],
      [{ tool: CALCULATION_TOOL, input: deep }],
      [calculate(GOOD)],
      'Hotovo.',
    ])
    expect(calculations().map((step) => [step.ran, step.result])).toEqual([
      [true, '1'],
      [true, '1110000'],
    ])
  })
})
