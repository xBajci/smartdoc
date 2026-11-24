import { MockLanguageModelV4 } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTurn } from '../../chat/types'
import { firstQueries, getRewriter } from './rewriter'

// The E2E tests run the fake rewriter; what the real one does with the model's
// answer is checked here against a scripted model.
const scripted = vi.hoisted(() => ({ model: undefined as unknown }))
vi.mock('../ai/models', async (original) => ({
  ...(await original<typeof import('../ai/models')>()),
  languageModel: () => scripted.model,
  modelName: () => 'openai:test',
  modelSetting: () => ({ provider: 'openai', model: 'test' }),
}))

const usage = {
  inputTokens: { total: 1000, noCache: 200, cacheRead: 800, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
}
const HISTORY: ChatTurn[] = [
  { role: 'visitor', text: 'Kdo vymění veřejné osvětlení?' },
  { role: 'archive', text: 'Elektro Haná.' },
]

/** The model answers with this text; the messages it was sent are kept. */
let sent: string[]
function answers(text: string | Error) {
  scripted.model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      sent = options.prompt.map((message) => message.role)
      if (text instanceof Error) throw text
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      }
    },
  })
}

const rewrite = (question: string, history: ChatTurn[] = []) =>
  getRewriter()({ question, history, instructions: 'Napiš dotazy.' })

describe('the rewrite of a chat question', () => {
  beforeEach(() => {
    sent = []
  })

  it('searches what the model wrote, with the conversation before the question', async () => {
    answers('{"dotazy":["veřejné osvětlení cena smlouva o dílo"]}')
    const step = await rewrite('A kolik to stálo?', HISTORY)
    expect(sent).toEqual(['system', 'user', 'assistant', 'user'])
    expect(step).toMatchObject({
      kind: 'rewrite',
      queries: ['veřejné osvětlení cena smlouva o dílo'],
      error: null,
      inputTokens: 1000,
      cachedInputTokens: 800,
    })
  })

  it('searches the question itself when the model fails, and says why', async () => {
    answers(new Error('Model nedostupný.'))
    const step = await rewrite('Kdo vymění veřejné osvětlení?')
    expect(step).toMatchObject({
      queries: ['Kdo vymění veřejné osvětlení?'],
      error: 'Model nedostupný.',
    })
  })

  it('searches nothing for a follow-up the conversation already answers', async () => {
    answers('{"dotazy":[]}')
    expect((await rewrite('Kdo to byl?', HISTORY)).queries).toEqual([])
  })
})

describe('the queries of the first search', () => {
  it('are trimmed, each once, and at most three', () => {
    expect(firstQueries([' rozpočet ', 'rozpočet', '', 'a', 'b', 'c'], 'Otázka?', [])).toEqual([
      'rozpočet',
      'a',
      'b',
    ])
  })

  it('are the question itself when there is none and no conversation to answer from', () => {
    expect(firstQueries(['  '], 'Kdo vymění osvětlení?', [])).toEqual(['Kdo vymění osvětlení?'])
  })
})
