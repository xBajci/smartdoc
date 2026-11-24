import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTraceStep } from '../../chat/types'
import { callsOfSteps, type CallsContext } from './question-calls'

const CONTEXT: CallsContext = {
  question: 'Kolik obec dá celkem?',
  embeddingModel: 'fake:embedding',
  summary: { use: 'chat-summary', text: '', skills: [{ key: 'chat/shrnuti', version: 0 }] },
  rewrite: { use: 'chat-rewrite', text: '', skills: [{ key: 'chat/glosar', version: 3 }] },
  answer: { use: 'chat-answer', text: '', skills: [{ key: 'chat/system', version: 1 }] },
  rerank: { use: 'chat-rerank', text: '', skills: [] },
}

const used = { inputTokens: 1000, outputTokens: 100, costUsd: 0.0012 }

/** A long conversation, a first search, then a model that searched, calculated and answered. */
const STEPS: ChatTraceStep[] = [
  {
    kind: 'summary',
    model: 'fake:summary',
    text: 'Shrnutí.',
    questions: 4,
    error: null,
    durationMs: 9,
    ...used,
  },
  {
    kind: 'rewrite',
    model: 'fake:rewrite',
    queries: ['osvětlení', 'dotace'],
    error: null,
    durationMs: 8,
    ...used,
  },
  {
    kind: 'search',
    query: 'osvětlení',
    durationMs: 50,
    embeddingTokens: 12,
    words: [],
    meaning: [],
    passages: [],
    weights: {
      model: 'fake:decision',
      exact: 0.8,
      both: 0.2,
      paraphrase: 0,
      words: 1.4,
      meaning: 0.6,
      durationMs: 3,
      inputTokens: 20,
      outputTokens: 0,
      costUsd: 0.00002,
      error: null,
    },
    rerank: {
      model: 'fake:decision',
      durationMs: 30,
      inputTokens: 400,
      outputTokens: 0,
      costUsd: 0.0004,
      candidates: [],
      error: 'Jev neodpověděl.',
    },
  },
  {
    kind: 'model',
    step: 1,
    model: 'fake:chat',
    text: '',
    searches: ['rozpočet 2025'],
    calculations: 2,
    durationMs: 7,
    ...used,
  },
  // Without a decision model a search is the embedding only.
  {
    kind: 'search',
    query: 'rozpočet 2025',
    durationMs: 20,
    embeddingTokens: 5,
    words: [],
    meaning: [],
    passages: [],
  },
  {
    kind: 'calculation',
    script: 'return 1',
    parameters: '{}',
    result: '1',
    error: null,
    ran: true,
    durationMs: 2,
  },
  {
    kind: 'model',
    step: 2,
    model: 'fake:chat',
    text: 'Celkem 1 Kč [1].',
    searches: [],
    durationMs: 6,
    ...used,
  },
]

describe('the calls of a chat question, as the records of AI calls keep them', () => {
  beforeEach(() => {
    vi.stubEnv('AI_PRICES', '{"fake:embedding":[1,0]}')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('are one for each model step and up to three for a search, in the order they were made', () => {
    const calls = callsOfSteps(STEPS, CONTEXT)
    expect(
      calls.map((call) => [call.operation, call.use, call.model, call.input, call.output]),
    ).toEqual([
      ['summary-chat', 'chat-summary', 'fake:summary', 'Otázek: 4', 'Shrnutí.'],
      ['rewrite', 'chat-rewrite', 'fake:rewrite', 'Kolik obec dá celkem?', 'osvětlení | dotace'],
      ['embed', null, 'fake:embedding', 'osvětlení', 'Úryvků: 0'],
      ['weigh', null, 'fake:decision', 'osvětlení', 'Váhy: slova 1.40, význam 0.60'],
      ['rerank', 'chat-rerank', 'fake:decision', 'osvětlení', 'Ohodnoceno úryvků: 0'],
      // A step that wrote no text says what it asked for.
      [
        'chat',
        'chat-answer',
        'fake:chat',
        'Kolik obec dá celkem?',
        'Hledat: rozpočet 2025, Spočítat: 2×',
      ],
      ['embed', null, 'fake:embedding', 'rozpočet 2025', 'Úryvků: 0'],
      [
        'chat',
        'chat-answer',
        'fake:chat',
        'Výsledky nástrojů z předchozího kroku.',
        'Celkem 1 Kč [1].',
      ],
    ])
  })

  it('carry the skills of their place, and none where the call is told none', () => {
    const calls = callsOfSteps(STEPS, CONTEXT)
    expect(calls.map((call) => call.skills)).toEqual([
      [{ key: 'chat/shrnuti', version: 0 }],
      [{ key: 'chat/glosar', version: 3 }],
      null,
      null,
      [],
      [{ key: 'chat/system', version: 1 }],
      null,
      [{ key: 'chat/system', version: 1 }],
    ])
  })

  it('give the embedding the time of the search without the reranking, and price it here', () => {
    const [, , embed, weigh, rerank, , plain] = callsOfSteps(STEPS, CONTEXT)
    // The search took 50 ms, 30 of them the reranking; the weighing ran beside the branches.
    expect(embed).toMatchObject({
      durationMs: 20,
      inputTokens: 12,
      outputTokens: 0,
      costUsd: 0.000012,
    })
    expect(weigh).toMatchObject({ durationMs: 3, inputTokens: 20, costUsd: 0.00002, error: null })
    expect(rerank).toMatchObject({ durationMs: 30, costUsd: 0.0004, error: 'Jev neodpověděl.' })
    expect(plain).toMatchObject({ durationMs: 20, inputTokens: 5, costUsd: 0.000005 })
  })
})
