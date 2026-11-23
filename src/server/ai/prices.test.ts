import { afterEach, describe, expect, it } from 'vitest'
import { costOfCall } from './prices'

describe('costOfCall', () => {
  afterEach(() => {
    delete process.env.AI_PRICES
  })

  it('prices input and output tokens separately', () => {
    expect(costOfCall('anthropic:claude-sonnet-5-5', 1_000_000, 100_000)).toBeCloseTo(3)
  })

  it('prices input read from the cache and written to it at their own prices', () => {
    // 600k uncached at 2, 300k read at 0.2, 100k written at 2.5, 100k output at 10.
    const cost = costOfCall('anthropic:claude-sonnet-5-5', 1_000_000, 100_000, {
      read: 300_000,
      written: 100_000,
    })
    expect(cost).toBeCloseTo(1.2 + 0.06 + 0.25 + 1)
  })

  it('prices cached input as other input when the model has no cache price', () => {
    process.env.AI_PRICES = '{"openai:some-model":[1,2]}'
    const cost = costOfCall('openai:some-model', 1_000_000, 0, { read: 500_000, written: 0 })
    expect(cost).toBeCloseTo(1)
  })

  it('does not guess the price of an unknown model', () => {
    expect(costOfCall('openai:some-model', 1000, 1000)).toBeNull()
  })

  it('takes a price from AI_PRICES first', () => {
    process.env.AI_PRICES =
      '{"openai:some-model":[1,2,0.1],"anthropic:claude-sonnet-5-5":[4,20],"openai:bad":[1,2,3,4,5]}'
    expect(costOfCall('openai:some-model', 1_000_000, 1_000_000)).toBeCloseTo(3)
    expect(
      costOfCall('openai:some-model', 1_000_000, 0, { read: 1_000_000, written: 0 }),
    ).toBeCloseTo(0.1)
    expect(costOfCall('anthropic:claude-sonnet-5-5', 1_000_000, 0)).toBeCloseTo(4)
    expect(costOfCall('openai:bad', 1000, 1000)).toBeNull()
  })

  it('ignores a broken AI_PRICES', () => {
    process.env.AI_PRICES = 'not json'
    expect(costOfCall('anthropic:claude-haiku-5-5', 1_000_000, 0)).toBeCloseTo(0.1)
  })
})
