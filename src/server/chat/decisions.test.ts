import { describe, expect, it } from 'vitest'
import { branchWeights, fakeDecider, orderByScore } from './decisions'

describe('branchWeights', () => {
  it('gives both branches the same weight for a query of both kinds', () => {
    expect(branchWeights({ exact: 0.2, paraphrase: 0.2 }, 0.5)).toEqual({ words: 1, meaning: 1 })
  })

  it('moves the weight to the words for a query that asks for exact words', () => {
    expect(branchWeights({ exact: 1, paraphrase: 0 }, 0.5)).toEqual({ words: 1.5, meaning: 0.5 })
  })

  it('moves the weight to the meaning for a query in own words', () => {
    const weights = branchWeights({ exact: 0.1, paraphrase: 0.7 }, 0.5)
    expect(weights.words).toBeCloseTo(0.7)
    expect(weights.meaning).toBeCloseTo(1.3)
  })

  it('never switches a branch off below zero', () => {
    expect(branchWeights({ exact: 1, paraphrase: 0 }, 3)).toEqual({ words: 2, meaning: 0 })
  })
})

describe('orderByScore', () => {
  it('puts the highest score first and keeps the given number of pieces', () => {
    expect(orderByScore([0.1, 0.9, 0.5], 2)).toEqual([1, 2])
  })

  it('keeps the order of the fusion between equal scores', () => {
    expect(orderByScore([0.5, 0.2, 0.5], 3)).toEqual([0, 2, 1])
  })
})

describe('fakeDecider', () => {
  it('scores a piece by the share of the words of the query it has', async () => {
    const { scores } = await fakeDecider.rerank(
      'Kdo?',
      'oprava chodníku',
      [
        { title: 'Smlouva', text: 'Oprava chodníku v ulici Zahradní.' },
        { title: 'Zpravodaj', text: 'Nový chodník u školy.' },
        { title: 'Hody', text: 'Průvod vyjde v sobotu.' },
      ],
      '',
    )
    expect(scores).toEqual([1, 0.5, 0])
  })

  it('takes a query with a number as a search for exact words', async () => {
    expect((await fakeDecider.weigh('Kolik?', 'usnesení 12/2026')).exact).toBe(0.8)
  })
})
