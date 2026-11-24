import { getTableColumns } from 'drizzle-orm'
import { calendarDay } from '../archive/query'
import type { DocumentChanges } from '../archive/types'
import { cs } from '../copy/cs'
import { documents, type CategoryRow, type DocumentRow } from '../db/schema'
import type { Summary } from './ai/reader'

/**
 * Who may change what on a document. The name, the date and the category of a
 * document each remember where they came from: the file name, processing
 * (`auto`) or the administrator (`manual`). What the administrator typed is
 * theirs, and processing never replaces it. This is the one place that knows
 * the rule. It says what an upload, an edit of the administrator and a
 * processing run write; the callers only store what it gives them.
 */

type Values = Partial<typeof documents.$inferInsert>

/** The part of a document the rule reads. */
export type Current = Pick<
  DocumentRow,
  | 'title'
  | 'titleSource'
  | 'categoryId'
  | 'categorySource'
  | 'issuedYear'
  | 'issuedOn'
  | 'issuedYearSource'
>

/**
 * Where the values of a new document come from. A category the administrator
 * chose in the upload is theirs; without one the document waits in the
 * fallback category for processing. A year guessed from the file name is not theirs.
 */
export function atUpload(
  choseCategory: boolean,
  guessedYear: number | null,
): Pick<DocumentRow, 'categorySource' | 'issuedYearSource'> {
  return {
    categorySource: choseCategory ? 'manual' : 'default',
    issuedYearSource: guessedYear === null ? null : 'auto',
  }
}

/** What an edit of the administrator writes. A value they changed becomes theirs; the rest keeps its source. */
export function byAdministrator(current: Current, changes: DocumentChanges) {
  const title = changes.title.trim() || current.title
  // A whole date says the year too.
  const issuedYear =
    changes.issuedOn === null ? changes.issuedYear : Number(changes.issuedOn.slice(0, 4))
  const dateChanged = issuedYear !== current.issuedYear || changes.issuedOn !== current.issuedOn
  return {
    title,
    titleSource: title === current.title ? current.titleSource : 'manual',
    categoryId: changes.categoryId,
    categorySource: changes.categoryId === current.categoryId ? current.categorySource : 'manual',
    customDescription: changes.customDescription.trim(),
    issuedYear,
    issuedOn: changes.issuedOn,
    issuedYearSource: dateChanged
      ? issuedYear === null
        ? null
        : 'manual'
      : current.issuedYearSource,
  } satisfies Values
}

/** What a processing run found in the content of a document. */
export interface Found {
  /** The whole text of a PDF, or the paragraph about an image. */
  text: string
  pageCount: number | null
  summary: Summary | null
}

/** The longest name a run gives a document. */
const TITLE_CHARACTERS = 300

function foundTitle(summary: Summary | null): string {
  return summary?.title.trim().slice(0, TITLE_CHARACTERS) ?? ''
}

/**
 * The name a document has after a run: the one from its content, unless the
 * administrator named it or the content gave none. The file name stays visible
 * next to the name, so nothing is lost by replacing it.
 */
export function titleAfter(current: Current, summary: Summary | null): string {
  const title = foundTitle(summary)
  return current.titleSource !== 'manual' && title !== '' ? title : current.title
}

/**
 * Whether a run asks the decision model for the category: a category the
 * administrator chose is `kept`, and a document without text gives the model
 * nothing to choose from.
 */
export function categoryChoice(
  current: Pick<Current, 'categorySource'>,
  text: string,
): 'ask' | 'kept' | 'no-text' {
  if (current.categorySource === 'manual') return 'kept'
  return text === '' ? 'no-text' : 'ask'
}

/** A year a document may carry: not before the year 1000 and not after the next year. */
function validYear(year: number | null, thisYear: number): number | null {
  return year !== null && year >= 1000 && year <= thisYear + 1 ? year : null
}

export interface RunChanges {
  /** What the run writes to `documents`. */
  values: Values
  /** The same values by table and column, in the order they are written, for the record of the run. */
  saved: { target: string; value: string | number | boolean | null }[]
  /** What the run left as it was, and why, for the record of the run. */
  kept: string[]
}

/**
 * What a processing run that went well writes. `category` is the one the
 * decision model chose, when it was asked and was sure. `current` must be the
 * document as it is now: the administrator may have edited it during the run.
 */
export function byProcessing(
  current: Current,
  found: Found,
  category: Pick<CategoryRow, 'id' | 'name'> | undefined,
  thisYear = new Date().getFullYear(),
): RunChanges {
  const summary = found.summary
  const title = foundTitle(summary)
  const renamed = current.titleSource !== 'manual' && title !== ''
  // A whole date says the year too; a date outside the years a document may carry is dropped.
  const day = calendarDay(summary?.issuedOn ?? null)
  const issuedOn =
    day !== null && validYear(Number(day.slice(0, 4)), thisYear) !== null ? day : null
  const year =
    issuedOn === null
      ? validYear(summary?.issuedYear ?? null, thisYear)
      : Number(issuedOn.slice(0, 4))
  const dated = current.issuedYearSource !== 'manual' && year !== null
  const filed = category !== undefined && current.categorySource !== 'manual'

  const values: Values = {
    status: 'ready',
    extractedText: found.text,
    shortDescription: summary?.shortDescription.trim() ?? '',
    hasText: found.text !== '',
    pageCount: found.pageCount,
    ...(renamed ? { title, titleSource: 'auto' as const } : {}),
    ...(dated ? { issuedYear: year, issuedOn, issuedYearSource: 'auto' as const } : {}),
    ...(filed ? { categoryId: category.id, categorySource: 'auto' as const } : {}),
  }

  const columns = getTableColumns(documents)
  const saved = Object.entries(values).map(([key, value]) => ({
    target: `documents.${columns[key as keyof typeof columns].name}`,
    // The record names the category too; an id alone says little.
    value:
      key === 'categoryId' && category !== undefined
        ? `${category.id} (${category.name})`
        : (value as string | number | boolean | null),
  }))

  const kept = [
    renamed ? null : current.titleSource === 'manual' ? cs.trace.titleKept : cs.trace.titleEmpty,
    dated ? null : current.issuedYearSource === 'manual' ? cs.trace.yearKept : cs.trace.yearUnknown,
  ].filter((line) => line !== null)

  return { values, saved, kept }
}
