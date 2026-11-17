import { describe, expect, it } from 'vitest'
import { defaultOrder, normalizeLibrarySearch, searchWords } from './query'

describe('searchWords', () => {
  it('drops diacritics, capitals and punctuation', () => {
    expect(searchWords('Schválený ROZPOČET, 2025!')).toEqual(['schvaleny', 'rozpocet', '2025'])
  })

  it('splits a file name into its words', () => {
    expect(searchWords('rozpocet-2025_navrh.pdf')).toEqual(['rozpocet', '2025', 'navrh', 'pdf'])
  })

  it('keeps a word once and returns nothing for an empty search', () => {
    expect(searchWords('zápis Zapis')).toEqual(['zapis'])
    expect(searchWords('  ')).toEqual([])
    expect(searchWords(undefined)).toEqual([])
  })
})

describe('defaultOrder', () => {
  it('is best match for a search and newest otherwise', () => {
    expect(defaultOrder('rozpočet')).toBe('shoda')
    expect(defaultOrder(undefined)).toBe('nove')
    expect(defaultOrder('...')).toBe('nove')
  })
})

describe('normalizeLibrarySearch', () => {
  it('drops values it does not know', () => {
    expect(
      normalizeLibrarySearch({ zobrazeni: 'tabulka', rok: 'loni', strana: -2, pocet: 0 }),
    ).toEqual({})
  })

  it('keeps known values', () => {
    expect(
      normalizeLibrarySearch({ q: 'most', rok: 2024, zobrazeni: 'nahled', strana: 3, pocet: 5000 }),
    ).toMatchObject({ q: 'most', rok: 2024, zobrazeni: 'nahled', strana: 3, pocet: 1000 })
  })
})
