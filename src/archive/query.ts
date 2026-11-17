import type { FileKindFilter, LibrarySearch, SortOrder, ViewMode, YearFilter } from './types'

const VIEW_MODES: readonly ViewMode[] = ['seznam', 'nahled']
const FILE_KINDS: readonly FileKindFilter[] = ['pdf', 'obrazek']
const SORT_ORDERS: readonly SortOrder[] = [
  'shoda',
  'vydane',
  'vydane-z',
  'nove',
  'stare',
  'nazev',
  'nazev-z',
  'kategorie',
  'kategorie-z',
]

/** Rows a page of the administration may show; the first is used when nothing else is asked for. */
export const PAGE_SIZES: readonly number[] = [10, 20, 50]
export const DEFAULT_PAGE_SIZE = 10
/** How many documents "Zobrazit další" adds to the list of the library. */
export const LIST_STEP = 10
/** The most documents one request returns. */
export const MAX_LIST_ROWS = 1000

/** Lower-cases and strips diacritics so that "mostenice" finds "Moštěnice". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function text(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value)
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value)
}

export function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(text(value))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/** How many documents a list is asked for, never more than the server gives at once. */
export function rowCount(value: unknown): number | undefined {
  const count = positiveInteger(value)
  return count === undefined ? undefined : Math.min(count, MAX_LIST_ROWS)
}

function year(value: unknown): YearFilter | undefined {
  if (value === 'neznamy') return 'neznamy'
  return positiveInteger(value)
}

/** Turns whatever arrives in the URL into a known search; unknown values are dropped. */
export function normalizeLibrarySearch(search: Record<string, unknown>): LibrarySearch {
  return {
    q: text(search.q),
    kategorie: text(search.kategorie),
    rok: year(search.rok),
    typ: oneOf(search.typ, FILE_KINDS),
    zobrazeni: oneOf(search.zobrazeni, VIEW_MODES),
    razeni: oneOf(search.razeni, SORT_ORDERS),
    pocet: rowCount(search.pocet),
    doc: text(search.doc),
    strana: positiveInteger(search.strana),
  }
}

export type LibraryFilters = Pick<LibrarySearch, 'q' | 'kategorie' | 'rok' | 'typ'>

/** The most words of a list search that are looked for; the rest is ignored. */
const MAX_SEARCH_WORDS = 10

/**
 * The words of a search as the full-text index knows them: no diacritics, no
 * capitals, letters and digits only. A document matches when it has, for
 * every word, some word that begins with it.
 */
export function searchWords(query: string | undefined, most = MAX_SEARCH_WORDS): string[] {
  const words = normalizeText(query ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
  return [...new Set(words)].slice(0, most)
}

/** The order a list has when the address names none: best match for a search, newest otherwise. */
export function defaultOrder(query: string | undefined): SortOrder {
  return searchWords(query).length === 0 ? 'nove' : 'shoda'
}

/** The order the library starts with: best match for a search, otherwise by the date of the document. */
export function libraryOrder(query: string | undefined): SortOrder {
  return searchWords(query).length === 0 ? 'vydane' : 'shoda'
}

/** A real calendar day written as `YYYY-MM-DD`, or `null`. */
export function calendarDay(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const day = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value ? value : null
}

export function hasActiveFilters(filters: LibraryFilters): boolean {
  return (
    filters.q !== undefined ||
    filters.kategorie !== undefined ||
    filters.rok !== undefined ||
    filters.typ !== undefined
  )
}
