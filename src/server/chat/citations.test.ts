import { describe, expect, it } from 'vitest'
import type { ChatPassage } from '../../chat/types'
import { resolveCitations } from './citations'

function passage(number: number, documentId: string, page: number | null): ChatPassage {
  return {
    number,
    chunkId: number,
    documentId,
    documentTitle: documentId,
    page,
    text: '',
    wordRank: 1,
    meaningRank: null,
    fusedScore: 0,
  }
}

describe('resolveCitations', () => {
  const passages = [passage(1, 'zapis', 1), passage(2, 'zapis', 1), passage(4, 'rozpocet', 3)]

  it('numbers sources from one in the order the answer uses them', () => {
    const result = resolveCitations(
      'Rozpočet je vyrovnaný [4]. Schválen byl v březnu [1].',
      passages,
    )
    expect(result.text).toBe('Rozpočet je vyrovnaný [1]. Schválen byl v březnu [2].')
    expect(result.sources).toEqual([
      { documentId: 'rozpocet', page: 3 },
      { documentId: 'zapis', page: 1 },
    ])
  })

  it('joins two pieces of one page into one source', () => {
    const result = resolveCitations('Schváleno [1][2].', passages)
    expect(result.text).toBe('Schváleno [1].')
    expect(result.sources).toEqual([{ documentId: 'zapis', page: 1 }])
  })

  it('removes a mark that points at no piece', () => {
    const result = resolveCitations('Nevím [9].', passages)
    expect(result.text).toBe('Nevím.')
    expect(result.sources).toEqual([])
  })

  it('gives an image a source without a page', () => {
    const result = resolveCitations('Kostel [7].', [passage(7, 'foto', null)])
    expect(result.sources).toEqual([{ documentId: 'foto' }])
  })
})
