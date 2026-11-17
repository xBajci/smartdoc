import { describe, expect, it } from 'vitest'
import { chunkPages, splitText } from './chunks'

describe('splitText', () => {
  it('keeps a short text whole', () => {
    expect(splitText('  Krátký   text.  ', 100, 10)).toEqual(['Krátký text.'])
  })

  it('returns nothing for an empty page', () => {
    expect(splitText('  \n ', 100, 10)).toEqual([])
  })

  it('cuts at the end of a sentence and never over the size', () => {
    const sentence = 'Zastupitelstvo schválilo rozpočet obce na příští rok. '
    const pieces = splitText(sentence.repeat(10), 120, 0)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(120)
      expect(piece.endsWith('.')).toBe(true)
    }
    expect(pieces.join(' ')).toBe(sentence.repeat(10).trim())
  })

  it('repeats the end of a piece at the start of the next one', () => {
    const words = Array.from({ length: 60 }, (_, index) => `slovo${index}`).join(' ')
    const [first, second] = splitText(words, 200, 40)
    const lastWord = first?.split(' ').at(-1) ?? ''
    expect(second?.split(' ')).toContain(lastWord)
  })

  it('ends even when the text has no place to cut', () => {
    const pieces = splitText('x'.repeat(1000), 100, 20)
    expect(pieces.join('').length).toBeGreaterThanOrEqual(1000)
    expect(pieces.every((piece) => piece.length <= 100)).toBe(true)
  })
})

describe('chunkPages', () => {
  it('keeps the page of every piece and skips empty pages', () => {
    const chunks = chunkPages(
      [
        { page: 1, text: 'První strana.' },
        { page: 2, text: '' },
        { page: 3, text: 'Třetí strana.' },
      ],
      100,
      10,
    )
    expect(chunks).toEqual([
      { page: 1, text: 'První strana.' },
      { page: 3, text: 'Třetí strana.' },
    ])
  })
})
