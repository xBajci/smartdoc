import { describe, expect, it } from 'vitest'
import { fuseRanks } from './fusion'

describe('fuseRanks', () => {
  it('puts a piece found by both branches above a piece found by one', () => {
    const fused = fuseRanks(
      [
        { chunkId: 1, rank: 1 },
        { chunkId: 2, rank: 2 },
      ],
      [
        { chunkId: 2, rank: 1 },
        { chunkId: 3, rank: 2 },
      ],
      60,
      10,
    )
    expect(fused.map((item) => item.chunkId)).toEqual([2, 1, 3])
    expect(fused[0]).toMatchObject({ wordRank: 2, meaningRank: 1 })
    expect(fused[0]?.fusedScore).toBeCloseTo(1 / 62 + 1 / 61)
    expect(fused[1]).toMatchObject({ wordRank: 1, meaningRank: null })
  })

  it('keeps only the asked number of pieces', () => {
    const words = [1, 2, 3, 4].map((chunkId, index) => ({ chunkId, rank: index + 1 }))
    expect(fuseRanks(words, [], 60, 2).map((item) => item.chunkId)).toEqual([1, 2])
  })

  it('lets the heavier branch decide between pieces found by one branch each', () => {
    const words = [{ chunkId: 1, rank: 1 }]
    const meaning = [{ chunkId: 2, rank: 1 }]
    const order = (weights: { words: number; meaning: number }) =>
      fuseRanks(words, meaning, 60, 2, weights).map((item) => item.chunkId)
    expect(order({ words: 1.5, meaning: 0.5 })).toEqual([1, 2])
    expect(order({ words: 0.5, meaning: 1.5 })).toEqual([2, 1])
  })

  it('returns nothing when no branch found anything', () => {
    expect(fuseRanks([], [], 60, 5)).toEqual([])
  })
})
