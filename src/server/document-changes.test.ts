import { describe, expect, it } from 'vitest'
import type { DocumentChanges } from '../archive/types'
import { cs } from '../copy/cs'
import type { Summary } from './ai/reader'
import {
  atUpload,
  byAdministrator,
  byProcessing,
  categoryChoice,
  titleAfter,
  type Current,
  type Found,
} from './document-changes'

/** A document as an upload leaves it: named after its file, in the fallback category, with no date. */
const uploaded: Current = {
  title: 'zapis-2021',
  titleSource: 'filename',
  categoryId: 'nezarazene',
  categorySource: 'default',
  issuedYear: null,
  issuedOn: null,
  issuedYearSource: null,
}

const summary = (found: Partial<Summary> = {}): Summary => ({
  title: 'Zápis ze zasedání',
  shortDescription: ' Zápis z jednání zastupitelstva. ',
  issuedYear: null,
  issuedOn: null,
  ...found,
})

const found = (of: Partial<Summary> = {}, text = 'Text zápisu.'): Found => ({
  text,
  pageCount: 2,
  summary: summary(of),
})

const minutes = { id: 'zapisy', name: 'Zápisy' }

describe('what an upload writes', () => {
  it("makes a chosen category the administrator's and a guessed year not", () => {
    expect(atUpload(true, 2021)).toEqual({ categorySource: 'manual', issuedYearSource: 'auto' })
    expect(atUpload(false, null)).toEqual({ categorySource: 'default', issuedYearSource: null })
  })
})

describe('what an edit of the administrator writes', () => {
  const edit = (changes: Partial<DocumentChanges>): DocumentChanges => ({
    title: uploaded.title,
    categoryId: uploaded.categoryId,
    customDescription: '',
    issuedYear: uploaded.issuedYear,
    issuedOn: uploaded.issuedOn,
    ...changes,
  })

  it('leaves the source of every value the administrator did not change', () => {
    expect(byAdministrator(uploaded, edit({ customDescription: ' Poznámka ' }))).toMatchObject({
      titleSource: 'filename',
      categorySource: 'default',
      issuedYearSource: null,
      customDescription: 'Poznámka',
    })
  })

  it("makes a changed name, category and date the administrator's", () => {
    expect(
      byAdministrator(uploaded, edit({ title: 'Zápis', categoryId: 'zapisy', issuedYear: 2021 })),
    ).toMatchObject({
      title: 'Zápis',
      titleSource: 'manual',
      categoryId: 'zapisy',
      categorySource: 'manual',
      issuedYear: 2021,
      issuedYearSource: 'manual',
    })
  })

  it('takes the year from a whole date', () => {
    expect(
      byAdministrator(uploaded, edit({ issuedYear: 1999, issuedOn: '2021-05-17' })),
    ).toMatchObject({ issuedYear: 2021, issuedOn: '2021-05-17', issuedYearSource: 'manual' })
  })

  it('keeps the name when the administrator empties it', () => {
    expect(byAdministrator(uploaded, edit({ title: '  ' }))).toMatchObject({
      title: 'zapis-2021',
      titleSource: 'filename',
    })
  })

  it('gives a date the administrator removed back to processing', () => {
    const dated: Current = { ...uploaded, issuedYear: 2021, issuedYearSource: 'manual' }
    expect(byAdministrator(dated, edit({ issuedYear: null }))).toMatchObject({
      issuedYear: null,
      issuedYearSource: null,
    })
  })
})

describe('what a processing run writes', () => {
  it('names, dates and files a document nobody has touched', () => {
    const { values, kept } = byProcessing(
      uploaded,
      found({ issuedOn: '2021-05-17' }),
      minutes,
      2026,
    )
    expect(values).toEqual({
      status: 'ready',
      extractedText: 'Text zápisu.',
      shortDescription: 'Zápis z jednání zastupitelstva.',
      hasText: true,
      pageCount: 2,
      title: 'Zápis ze zasedání',
      titleSource: 'auto',
      issuedYear: 2021,
      issuedOn: '2021-05-17',
      issuedYearSource: 'auto',
      categoryId: 'zapisy',
      categorySource: 'auto',
    })
    expect(kept).toEqual([])
  })

  it('replaces what an earlier run wrote', () => {
    const processed: Current = {
      ...uploaded,
      title: 'Starý název',
      titleSource: 'auto',
      issuedYear: 2019,
      issuedYearSource: 'auto',
      categorySource: 'auto',
    }
    expect(
      byProcessing(processed, found({ issuedYear: 2021 }), minutes, 2026).values,
    ).toMatchObject({
      title: 'Zápis ze zasedání',
      issuedYear: 2021,
      issuedOn: null,
      categoryId: 'zapisy',
    })
  })

  it('never replaces a name, a date or a category the administrator typed', () => {
    const edited: Current = {
      title: 'Název od správce',
      titleSource: 'manual',
      categoryId: 'smlouvy',
      categorySource: 'manual',
      issuedYear: 2020,
      issuedOn: null,
      issuedYearSource: 'manual',
    }
    const { values, kept } = byProcessing(edited, found({ issuedOn: '2021-05-17' }), minutes, 2026)
    expect(values).toEqual({
      status: 'ready',
      extractedText: 'Text zápisu.',
      shortDescription: 'Zápis z jednání zastupitelstva.',
      hasText: true,
      pageCount: 2,
    })
    expect(kept).toEqual([cs.trace.titleKept, cs.trace.yearKept])
    expect(titleAfter(edited, summary())).toBe('Název od správce')
    expect(categoryChoice(edited, 'Text zápisu.')).toBe('kept')
  })

  it('keeps the name and the date when the content gives none', () => {
    const { values, kept } = byProcessing(uploaded, found({ title: '  ' }), undefined, 2026)
    expect(values).not.toHaveProperty('title')
    expect(values).not.toHaveProperty('issuedYear')
    expect(values).not.toHaveProperty('categoryId')
    expect(kept).toEqual([cs.trace.titleEmpty, cs.trace.yearUnknown])
    expect(titleAfter(uploaded, summary({ title: '' }))).toBe('zapis-2021')
  })

  it('drops a date outside the years a document may carry', () => {
    expect(
      byProcessing(uploaded, found({ issuedOn: '2031-01-01' }), undefined, 2026).values,
    ).not.toHaveProperty('issuedOn')
    expect(
      byProcessing(uploaded, found({ issuedYear: 2027 }), undefined, 2026).values,
    ).toMatchObject({ issuedYear: 2027, issuedOn: null })
    expect(
      byProcessing(uploaded, found({ issuedYear: 999 }), undefined, 2026).values,
    ).not.toHaveProperty('issuedYear')
  })

  it('writes a document without text as one, and asks for no category', () => {
    const empty: Found = { text: '', pageCount: 1, summary: null }
    expect(byProcessing(uploaded, empty, undefined, 2026).values).toEqual({
      status: 'ready',
      extractedText: '',
      shortDescription: '',
      hasText: false,
      pageCount: 1,
    })
    expect(categoryChoice(uploaded, '')).toBe('no-text')
    expect(categoryChoice(uploaded, 'Text.')).toBe('ask')
  })

  it('names every stored value by its column, the category with its name', () => {
    const { saved } = byProcessing(uploaded, found(), minutes, 2026)
    expect(saved.map(({ target }) => target)).toEqual([
      'documents.status',
      'documents.auto_description',
      'documents.short_description',
      'documents.has_text',
      'documents.page_count',
      'documents.title',
      'documents.title_source',
      'documents.category_id',
      'documents.category_source',
    ])
    expect(saved.find(({ target }) => target === 'documents.category_id')?.value).toBe(
      'zapisy (Zápisy)',
    )
  })
})
