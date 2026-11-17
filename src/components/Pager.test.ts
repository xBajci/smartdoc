import { describe, expect, it } from 'vitest'
import { pagesToOffer } from './Pager'

describe('pagesToOffer', () => {
  it('lists every page of a short list', () => {
    expect(pagesToOffer(2, 3)).toEqual([1, 2, 3])
  })

  it('keeps the first, the last and the neighbours, with gaps between', () => {
    expect(pagesToOffer(6, 12)).toEqual([1, null, 5, 6, 7, null, 12])
  })

  it('fills a gap of one page with the page itself', () => {
    expect(pagesToOffer(3, 12)).toEqual([1, 2, 3, 4, null, 12])
    expect(pagesToOffer(10, 12)).toEqual([1, null, 9, 10, 11, 12])
  })
})
