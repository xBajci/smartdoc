import { and, asc, count, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import { DEFAULT_PAGE_SIZE, defaultOrder, searchWords } from '../archive/query'
import type { DocumentPage, DocumentQuery } from '../archive/types'
import { getDatabase } from '../db/client'
import { categories, documents } from '../db/schema'
import { listColumns, toDocument, usageByDocument } from './archive-service'

/** Marks that the database puts around a found word; they never occur in a real text. */
const HIT_START = '\u0001'
const HIT_END = '\u0002'
const HEADLINE_OPTIONS = `StartSel=${HIT_START},StopSel=${HIT_END},MaxFragments=1,MaxWords=28,MinWords=10`

/** Czech alphabetical order: "ch" after "h", letters with diacritics next to their base letter. */
const czech = (column: SQL | typeof documents.title) => sql`${column} collate "cs-x-icu"`

/** The words around a match as plain text, or `null` when the content holds no searched word. */
function cleanSnippet(headline: string | null): string | null {
  if (headline === null || !headline.includes(HIT_START)) return null
  const text = headline.replaceAll(HIT_START, '').replaceAll(HIT_END, '').replace(/\s+/g, ' ')
  return `… ${text.trim()} …`
}

/** The searched words as a full-text query, or `null` when nothing is searched. */
function soughtWords(q: string | undefined): SQL | null {
  const words = searchWords(q)
  return words.length === 0
    ? null
    : sql`to_tsquery('cs_simple', ${words.map((word) => `${word}:*`).join(' & ')})`
}

/** What the search field and the filters of a list ask of a document. */
export function listFilters(query: Pick<DocumentQuery, 'q' | 'kategorie' | 'rok' | 'typ'>): SQL[] {
  const conditions: SQL[] = []
  if (query.kategorie !== undefined) conditions.push(eq(documents.categoryId, query.kategorie))
  if (query.rok === 'neznamy') conditions.push(isNull(documents.issuedYear))
  if (typeof query.rok === 'number') conditions.push(eq(documents.issuedYear, query.rok))
  if (query.typ !== undefined) {
    conditions.push(eq(documents.format, query.typ === 'pdf' ? 'pdf' : 'image'))
  }
  const sought = soughtWords(query.q)
  if (sought !== null) conditions.push(sql`${documents.searchVector} @@ ${sought}`)
  return conditions
}

/**
 * One page of the documents that match a search. The search is full-text: it
 * looks into the name, the file name, the descriptions and the content, and
 * ignores diacritics. A visitor only ever gets public documents.
 */
export async function searchDocuments(
  query: DocumentQuery,
  includeUnpublished: boolean,
): Promise<DocumentPage> {
  const database = getDatabase()
  const visible = includeUnpublished ? undefined : eq(documents.status, 'ready')

  const sought = soughtWords(query.q)

  const conditions: (SQL | undefined)[] = [visible]
  if (includeUnpublished && query.stav !== undefined) {
    conditions.push(eq(documents.status, query.stav))
  }
  const statusConditions = [...conditions]
  conditions.push(...listFilters(query))
  const matching = and(...conditions)

  const [[matched], categoryRows, [all], [failed], yearRows] = await Promise.all([
    database.select({ total: count() }).from(documents).where(matching),
    // What each category would list: every condition but the category itself.
    database
      .select({ categoryId: documents.categoryId, total: count() })
      .from(documents)
      .where(and(...statusConditions, ...listFilters({ ...query, kategorie: undefined })))
      .groupBy(documents.categoryId),
    database.select({ total: count() }).from(documents).where(visible),
    includeUnpublished
      ? database.select({ total: count() }).from(documents).where(eq(documents.status, 'failed'))
      : [{ total: 0 }],
    database
      .selectDistinct({ year: documents.issuedYear })
      .from(documents)
      .where(and(visible, isNotNull(documents.issuedYear)))
      .orderBy(desc(documents.issuedYear)),
  ])

  const total = matched?.total ?? 0
  const pageSize = query.pocet ?? DEFAULT_PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(query.stranka ?? 1, pageCount)

  const newest = [desc(documents.addedAt), asc(documents.id)]
  // The date of the document itself: its day, or the first day of its year when only the
  // year is known. A document without any date comes last.
  const issued = sql`coalesce(${documents.issuedOn}, make_date(${documents.issuedYear}, 1, 1))`
  let order = query.razeni ?? defaultOrder(query.q)
  if (order === 'shoda' && sought === null) order = 'nove'
  const ordering: SQL[] =
    order === 'shoda' && sought !== null
      ? [sql`ts_rank(${documents.searchVector}, ${sought}) desc`, ...newest]
      : order === 'vydane'
        ? [sql`${issued} desc nulls last`, desc(czech(documents.title)), ...newest]
        : order === 'vydane-z'
          ? [sql`${issued} asc nulls last`, asc(czech(documents.title)), ...newest]
          : order === 'stare'
            ? [asc(documents.addedAt), asc(documents.id)]
            : order === 'nazev'
              ? [asc(czech(documents.title)), ...newest]
              : order === 'nazev-z'
                ? [desc(czech(documents.title)), ...newest]
                : order === 'kategorie'
                  ? [asc(czech(sql`${categories.name}`)), ...newest]
                  : order === 'kategorie-z'
                    ? [desc(czech(sql`${categories.name}`)), ...newest]
                    : newest

  const rows = await database
    .select({
      ...listColumns,
      // Looked for only on the rows of this page: reading a long content is slow.
      headline:
        sought === null
          ? sql<string | null>`null`
          : sql<string>`ts_headline('cs_simple', left(${documents.autoDescription}, 500000), ${sought}, ${HEADLINE_OPTIONS})`,
    })
    .from(documents)
    .innerJoin(categories, eq(categories.id, documents.categoryId))
    .where(matching)
    .orderBy(...ordering)
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const usage = includeUnpublished
    ? await usageByDocument(rows.map((row) => row.id))
    : new Map<string, never>()

  return {
    documents: rows.map(({ headline, ...row }) => ({
      ...toDocument(row, usage.get(row.id) ?? null),
      snippet: cleanSnippet(headline),
    })),
    total,
    page,
    pageCount,
    pageSize,
    categoryCounts: Object.fromEntries(categoryRows.map((row) => [row.categoryId, row.total])),
    years: yearRows.flatMap((row) => (row.year === null ? [] : [row.year])),
    archiveTotal: all?.total ?? 0,
    failedCount: failed?.total ?? 0,
  }
}
