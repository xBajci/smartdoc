import { afterEach, describe, expect, it } from 'vitest'
import { costOfCall } from './prices'

describe('costOfCall', () => {
  afterEach(() => {
    delete process.env.AI_PRICES
  })

  it('prices input and output tokens separately', () => {
    expect(costOfCall('anthropic:claude-sonnet-5-5', 1_000_000, 100_000)).toBeCloseTo(3)
  })

  it('does not guess the price of an unknown model', () => {
    expect(costOfCall('openai:some-model', 1000, 1000)).toBeNull()
  })

  it('takes a price from AI_PRICES first', () => {
    process.env.AI_PRICES = '{"openai:some-model":[1,2],"anthropic:claude-sonnet-5-5":[4,20]}'
    expect(costOfCall('openai:some-model', 1_000_000, 1_000_000)).toBeCloseTo(3)
    expect(costOfCall('anthropic:claude-sonnet-5-5', 1_000_000, 0)).toBeCloseTo(4)
  })

  it('ignores a broken AI_PRICES', () => {
    process.env.AI_PRICES = 'not json'
    expect(costOfCall('anthropic:claude-haiku-5-5', 1_000_000, 0)).toBeCloseTo(0.1)
  })
})
