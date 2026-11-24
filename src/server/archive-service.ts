import { randomUUID } from 'node:crypto'
import { asc, count, eq, getTableColumns, inArray, max, sql } from 'drizzle-orm'
import { CATEGORY_COLORS } from '../archive/categories'
import type {
  ArchiveDocument,
  Category,
  CategoryInput,
  DocumentChanges,
  DocumentUsage,
} from '../archive/types'
import {
  detectFormat,
  MAX_FILE_BYTES,
  SIGNATURE_BYTES,
  type UploadProblem,
} from '../archive/upload'
import { getDatabase } from '../db/client'
import { aiUsage, categories, documents, type CategoryRow, type DocumentRow } from '../db/schema'
import { atUpload, byAdministrator } from './document-changes'
import { isPublished, visibleTo } from './published'
import { getStorage } from './storage'
import { makeThumbnail } from './thumbnail'
import { titleFromFilename } from './title'

/** Everything about a document except its content, which is long and never shown in a list. */
const {
  extractedText: _content,
  searchVector: _searchVector,
  ...listColumns
} = getTableColumns(documents)
export { listColumns }

export type ListedRow = Omit<DocumentRow, 'extractedText' | 'searchVector'>

export function toDocument(row: ListedRow, usage: DocumentUsage | null = null): ArchiveDocument {
  return {
    id: row.id,
    originalFilename: row.originalFilename,
    title: row.title,
    titleSource: row.titleSource,
    format: row.format,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    fileUrl: `/soubor/${row.id}`,
    thumbnailUrl: row.thumbnailKey === null ? null : `/soubor/${row.id}/nahled`,
    sha256: row.sha256,
    categoryId: row.categoryId,
    addedAt: row.addedAt.toISOString(),
    issuedYear: row.issuedYear,
    issuedOn: row.issuedOn,
    issuedYearSource: row.issuedYearSource,
    customDescription: row.customDescription,
    shortDescription: row.shortDescription,
    status: row.status,
    hasText: row.hasText,
    errorReason: row.errorReason,
    pageCount: row.pageCount,
    usage,
  }
}

function toCategory(row: CategoryRow, documentCount: number, forAdmin: boolean): Category {
  return {
    id: row.id,
    name: row.name,
    // The hint is a working note of the administrator, not a text for visitors.
    description: forAdmin ? row.description : '',
    color: row.color,
    isFallback: row.isFallback,
    documentCount,
  }
}

/** The named documents the reader may see: every state for the administrator, public ones otherwise. */
export async function findDocuments(
  ids: readonly string[],
  includeUnpublished: boolean,
): Promise<ArchiveDocument[]> {
  if (ids.length === 0) return []
  const rows = await getDatabase()
    .select(listColumns)
    .from(documents)
    .where(inArray(documents.id, [...ids]))
  return rows.filter((row) => includeUnpublished || isPublished(row)).map((row) => toDocument(row))
}

/** Models and cost of every document that was read with AI, added up over all its runs. */
export async function usageByDocument(ids: readonly string[]): Promise<Map<string, DocumentUsage>> {
  if (ids.length === 0) return new Map()
  const rows = await getDatabase()
    .select({
      documentId: aiUsage.documentId,
      models: sql<string[]>`array_agg(distinct ${aiUsage.model} order by ${aiUsage.model})`,
      costUsd: sql<number | null>`sum(${aiUsage.costUsd})::float8`,
    })
    .from(aiUsage)
    .where(inArray(aiUsage.documentId, [...ids]))
    .groupBy(aiUsage.documentId)
  return new Map(rows.map(({ documentId, ...usage }) => [documentId ?? '', usage]))
}

/** The fallback category is always listed last. */
export async function listCategories(includeUnpublished: boolean): Promise<Category[]> {
  const database = getDatabase()
  const counting = database
    .select({ categoryId: documents.categoryId, total: count() })
    .from(documents)
  const [rows, counts] = await Promise.all([
    database
      .select()
      .from(categories)
      .orderBy(asc(categories.isFallback), asc(categories.position)),
    counting.where(visibleTo(includeUnpublished)).groupBy(documents.categoryId),
  ])
  const totals = new Map(counts.map((row) => [row.categoryId, row.total]))
  return rows.map((row) => toCategory(row, totals.get(row.id) ?? 0, includeUnpublished))
}

export async function findDocumentRow(id: string): Promise<DocumentRow | undefined> {
  const [row] = await getDatabase().select().from(documents).where(eq(documents.id, id))
  return row
}

/** The text processing took from the document. Kept out of the list: it can be very long. */
export async function findExtractedText(id: string): Promise<string> {
  const [row] = await getDatabase()
    .select({ text: documents.extractedText })
    .from(documents)
    .where(eq(documents.id, id))
  return row?.text ?? ''
}

export async function findDocumentIdBySha(sha256: string): Promise<string | null> {
  const [row] = await getDatabase()
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.sha256, sha256))
  return row?.id ?? null
}

/** A year between 1800 and next year found in a name, e.g. "rozpocet-2025.pdf". */
export function guessYear(text: string): number | null {
  const limit = new Date().getFullYear() + 1
  for (const match of text.matchAll(/(?<!\d)(1[89]\d{2}|20\d{2})(?!\d)/g)) {
    const year = Number(match[1])
    if (year <= limit) return year
  }
  return null
}

export function newDocumentId() {
  return randomUUID()
}

export interface NewDocument {
  id: string
  /** Where the uploaded original already lies in storage. */
  storageKey: string
  originalFilename: string
  categoryId: string
  customDescription: string
  sha256: string
}

export type CreateDocumentResult =
  | { ok: true; document: ArchiveDocument }
  | { ok: false; problem: UploadProblem | 'missing' }
  | { ok: false; problem: 'duplicate'; duplicateId: string }

function isUniqueViolation(error: unknown) {
  const cause = error instanceof Error && 'cause' in error ? error.cause : error
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505'
}

/**
 * Records a file that is already in storage. The file is checked here again —
 * what the browser claimed about it is not trusted — and it is removed from
 * storage whenever the record is refused, so nothing is left behind.
 */
export async function createDocument(input: NewDocument): Promise<CreateDocumentResult> {
  const storage = getStorage()
  const refuse = async <T extends CreateDocumentResult>(result: T): Promise<T> => {
    await storage.remove(input.storageKey)
    return result
  }

  const size = await storage.size(input.storageKey)
  if (size === null) return { ok: false, problem: 'missing' }
  if (size === 0) return refuse({ ok: false, problem: 'empty' })
  if (size > MAX_FILE_BYTES) return refuse({ ok: false, problem: 'too-large' })

  const start = await storage.readStart(input.storageKey, SIGNATURE_BYTES)
  const detected = start === null ? null : detectFormat(start)
  if (detected === null) return refuse({ ok: false, problem: 'unsupported' })

  const duplicateId = await findDocumentIdBySha(input.sha256)
  if (duplicateId !== null) return refuse({ ok: false, problem: 'duplicate', duplicateId })

  let thumbnailKey: string | null = null
  if (detected.format === 'image') {
    const original = await storage.readAll(input.storageKey)
    const thumbnail = original === null ? null : await makeThumbnail(original)
    if (thumbnail !== null) {
      thumbnailKey = await storage.write(`thumbnails/${input.id}.webp`, thumbnail, 'image/webp')
    }
  }

  const database = getDatabase()
  const [category] = await database
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, input.categoryId))
  // No category chosen: the fallback one for now, and processing picks a better one.
  const categoryId = category?.id ?? (await fallbackCategoryId())

  const title = titleFromFilename(input.originalFilename)
  const issuedYear = guessYear(title)
  try {
    const [row] = await database
      .insert(documents)
      .values({
        id: input.id,
        originalFilename: input.originalFilename,
        title,
        format: detected.format,
        mimeType: detected.mimeType,
        sizeBytes: size,
        sha256: input.sha256,
        storageKey: input.storageKey,
        thumbnailKey,
        categoryId,
        issuedYear,
        ...atUpload(category !== undefined, issuedYear),
        customDescription: input.customDescription.trim(),
        // Not public yet: processing reads the content first.
        status: 'queued',
      })
      .returning()
    if (row === undefined) throw new Error('Insert returned no row.')
    return { ok: true, document: toDocument(row) }
  } catch (error) {
    if (thumbnailKey !== null) await storage.remove(thumbnailKey)
    if (isUniqueViolation(error)) {
      const existing = await findDocumentIdBySha(input.sha256)
      if (existing !== null) {
        return refuse({ ok: false, problem: 'duplicate', duplicateId: existing })
      }
    }
    await storage.remove(input.storageKey)
    throw error
  }
}

export async function updateDocument(id: string, changes: DocumentChanges) {
  const current = await findDocumentRow(id)
  if (current === undefined) return
  await getDatabase()
    .update(documents)
    .set(byAdministrator(current, changes))
    .where(eq(documents.id, id))
}

/** The record goes first: a file without a record is harmless, a record without a file is not. */
export async function removeDocument(id: string) {
  const [removed] = await getDatabase().delete(documents).where(eq(documents.id, id)).returning()
  if (removed === undefined) return
  const storage = getStorage()
  await storage.remove(removed.storageKey)
  if (removed.thumbnailKey !== null) await storage.remove(removed.thumbnailKey)
}

async function fallbackCategoryId(): Promise<string> {
  const [fallback] = await getDatabase()
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.isFallback, true))
  if (fallback === undefined) throw new Error('The archive has no fallback category.')
  return fallback.id
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** The colour must be one of the palette, or the one the category has already. */
function acceptedColor(color: string, current?: string) {
  if (color !== current && !(CATEGORY_COLORS as readonly string[]).includes(color)) {
    throw new Error('Invalid input.')
  }
}

/** Returns the id of the new category. It goes after the last one and before the fallback category. */
export async function addCategory(input: CategoryInput): Promise<string> {
  const name = input.name.trim()
  if (name === '') throw new Error('Invalid input.')
  acceptedColor(input.color)
  const database = getDatabase()
  const existing = await database.select().from(categories)
  const taken = new Set(existing.map((category) => category.id))
  const stem = slugify(name) || 'kategorie'
  let id = stem
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${stem}-${suffix}`
  const [last] = await database.select({ position: max(categories.position) }).from(categories)
  await database.insert(categories).values({
    id,
    name,
    description: input.description.trim(),
    color: input.color,
    position: (last?.position ?? 0) + 1,
  })
  return id
}

/** The decision model reads the description from the next processing on. */
export async function updateCategory(id: string, input: CategoryInput) {
  const name = input.name.trim()
  if (name === '') throw new Error('Invalid input.')
  const database = getDatabase()
  const [current] = await database.select().from(categories).where(eq(categories.id, id))
  if (current === undefined) return
  acceptedColor(input.color, current.color)
  await database
    .update(categories)
    .set({ name, description: input.description.trim(), color: input.color })
    .where(eq(categories.id, id))
}

/** Puts the categories in the given order. The fallback category stays last and is not in the list. */
export async function reorderCategories(ids: readonly string[]) {
  await getDatabase().transaction(async (transaction) => {
    const movable = await transaction
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.isFallback, false))
    const known = new Set(movable.map((category) => category.id))
    // A list made from an older state of the archive must not change the order half way.
    if (ids.length !== known.size || new Set(ids).size !== ids.length) {
      throw new Error('Invalid input.')
    }
    if (ids.some((id) => !known.has(id))) throw new Error('Invalid input.')
    for (const [index, id] of ids.entries()) {
      await transaction
        .update(categories)
        .set({ position: index + 1 })
        .where(eq(categories.id, id))
    }
  })
}

/** Documents of a removed category move to the fallback category. */
export async function removeCategory(id: string) {
  await getDatabase().transaction(async (transaction) => {
    const [fallback] = await transaction
      .select()
      .from(categories)
      .where(eq(categories.isFallback, true))
    if (fallback === undefined || fallback.id === id) return
    await transaction
      .update(documents)
      .set({ categoryId: fallback.id })
      .where(eq(documents.categoryId, id))
    await transaction.delete(categories).where(eq(categories.id, id))
  })
}
