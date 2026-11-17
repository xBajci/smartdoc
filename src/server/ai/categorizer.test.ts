import { describe, expect, it } from 'vitest'
import { categoryCriteria, pickCategory } from './categorizer'

const categories = [
  { name: 'Zápisy', description: 'Zápisy ze zasedání zastupitelstva.', isFallback: false },
  { name: 'Zpravodaje', description: '', isFallback: false },
  { name: 'Nezařazené', description: '', isFallback: true },
]

describe('pickCategory', () => {
  it('takes the most likely category when it is sure enough', () => {
    expect(pickCategory({ Zápisy: 0.1, Zpravodaje: 0.9 }, categories, 0.7)).toBe('Zpravodaje')
  })

  it('files an unsure choice under the fallback category', () => {
    expect(pickCategory({ Zápisy: 0.3, Zpravodaje: 0.6 }, categories, 0.7)).toBe('Nezařazené')
  })

  it('names no category when the choice is unsure and the archive has no fallback', () => {
    expect(pickCategory({ Zápisy: 0.5 }, categories.slice(0, 2), 0.7)).toBeNull()
  })
})

describe('categoryCriteria', () => {
  it("adds the administrator's hint to the wording of a category", () => {
    const criteria = categoryCriteria(categories)
    expect(criteria['Zápisy']).toBe(
      'Dokument svým obsahem a účelem patří do kategorie „Zápisy“. Co do kategorie patří: Zápisy ze zasedání zastupitelstva.',
    )
    expect(criteria['Zpravodaje']).toBe(
      'Dokument svým obsahem a účelem patří do kategorie „Zpravodaje“.',
    )
    expect(criteria['Nezařazené']).toBe('Žádná jiná kategorie dokumentu neodpovídá.')
  })
})
