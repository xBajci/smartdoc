import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { costOfCalls, recorded, spent, unspent, type CallHead, type ModelCall } from './calls'

const HEAD: CallHead = {
  operation: 'summarize',
  use: 'describe-document',
  skills: [{ key: 'zpracovani/popis', version: 2 }],
  page: null,
  input: 'Text dokumentu.',
}

describe('the record of a call to a model', () => {
  beforeEach(() => {
    // [input, output, cache read, cache write] in dollars per million tokens.
    vi.stubEnv(
      'AI_PRICES',
      '{"openai:test":[1,2,0.1,1.25],"openai:plain":[1,2],"openai:big":[5,10]}',
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prices input from the cache lower and says how much of the input it was', () => {
    const used = spent('openai:test', {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      inputTokenDetails: { cacheReadTokens: 800_000, cacheWriteTokens: 0 },
    })
    // 200k uncached at 1, 800k from the cache at 0.1, 100k output at 2.
    expect(used).toMatchObject({
      inputTokens: 1_000_000,
      cachedInputTokens: 800_000,
      outputTokens: 100_000,
    })
    expect(used.costUsd).toBeCloseTo(0.2 + 0.08 + 0.2, 9)
  })

  it('says nothing of the cache for a model that reports none', () => {
    const used = spent('openai:plain', { inputTokens: 1000, outputTokens: 100 })
    expect(used).toEqual({ inputTokens: 1000, outputTokens: 100, costUsd: 0.0012 })
  })

  it('has no cost for a model whose price is not known', () => {
    expect(spent('openai:unknown', { inputTokens: 1000, outputTokens: 100 }).costUsd).toBeNull()
  })

  it('keeps a failed call as one that used nothing', () => {
    expect(unspent('openai:test')).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
    // Only an unknown price leaves the cost unknown, so a failed call is not counted as unpriced.
    expect(unspent('openai:unknown').costUsd).toBeNull()
  })

  it('records a call that went well with what it used and cost, and passes its value on', async () => {
    const calls: ModelCall[] = []
    const value = await recorded(
      (call) => calls.push(call),
      'openai:plain',
      HEAD,
      async () => ({
        value: { title: 'Rozpočet' },
        output: '{"title":"Rozpočet"}',
        usage: { inputTokens: 1000, outputTokens: 100 },
      }),
    )
    expect(value).toEqual({ title: 'Rozpočet' })
    expect(calls).toEqual([
      {
        ...HEAD,
        model: 'openai:plain',
        output: '{"title":"Rozpočet"}',
        error: null,
        durationMs: expect.any(Number),
        inputTokens: 1000,
        outputTokens: 100,
        costUsd: 0.0012,
      },
    ])
  })

  it('records a call that failed with the reason, then fails the same way', async () => {
    const calls: ModelCall[] = []
    const failing = recorded(
      (call) => calls.push(call),
      'openai:plain',
      HEAD,
      async () => {
        throw new Error('Model nedostupný.')
      },
    )
    await expect(failing).rejects.toThrow('Model nedostupný.')
    expect(calls).toMatchObject([
      {
        model: 'openai:plain',
        output: '',
        error: 'Model nedostupný.',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    ])
  })

  it('names the model that answered when only the answer says which', async () => {
    const calls: ModelCall[] = []
    await recorded(
      (call) => calls.push(call),
      'openai:plain',
      HEAD,
      async () => ({
        value: null,
        output: '',
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
        model: 'openai:big',
      }),
    )
    // Priced as the model that answered: 5 dollars per million tokens, not 1.
    expect(calls[0]).toMatchObject({ model: 'openai:big', costUsd: 5 })
  })

  it('keeps only the start of a very long input', async () => {
    const calls: ModelCall[] = []
    await recorded(
      (call) => calls.push(call),
      'openai:plain',
      { ...HEAD, input: 'a'.repeat(20_000) },
      async () => ({ value: null, output: '', usage: {} }),
    )
    expect(calls[0]?.input).toHaveLength(16_000)
  })

  it('adds up the calls with a known price; nothing but unknown prices is unknown', () => {
    expect(costOfCalls([{ costUsd: 0.5 }, { costUsd: null }, { costUsd: 0.25 }])).toBe(0.75)
    expect(costOfCalls([{ costUsd: null }])).toBeNull()
    expect(costOfCalls([])).toBeNull()
  })
})
