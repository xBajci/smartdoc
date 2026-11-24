import { randomUUID } from 'node:crypto'
import { and, eq, lt, ne, or, sql } from 'drizzle-orm'
import { calendarDay } from '../archive/query'
import type { ProcessingStep } from '../archive/types'
import { cs, fill } from '../copy/cs'
import { getDatabase } from '../db/client'
import { categories, documents, processingRuns, type DocumentRow } from '../db/schema'
import { recorded, storeCalls, type ModelCall, type RecordCall } from './ai/calls'
import {
  categoryCriteria,
  getCategorizer,
  type CategorizedDocument,
  type CategoryChoice,
} from './ai/categorizer'
import { missingKey, modelName } from './ai/models'
import { getReader, type DocumentReader, type Summary } from './ai/reader'
import { instructionsFor, type LoadedSkill } from './ai/skills'
import type { PageText } from './chat/chunks'
import { getEmbedder } from './chat/embedder'
import { prepareChunks, writeChunks } from './chat/index-service'
import { hasTextLayer, pageCutter, readPages, type PageLayout } from './pdf-text'
import { loadSkills } from './skills-service'
import { getStorage } from './storage'

export const MAX_PDF_PAGES = 300
/** Scanned pages read at the same time. */
const OCR_CONCURRENCY = 3
/** A run that has not finished in this time is taken for dead and may be started again. */
const STALE_AFTER_MINUTES = 10

/** A failure whose reason the administrator can read and act on. */
class ProcessingError extends Error {}

interface Extracted {
  /** Goes to `auto_description`: the whole text of a PDF, or the paragraph about an image. */
  text: string
  /** The same text page by page; the chat searches in pieces of it. */
  pages: PageText[]
  pageCount: number | null
  summary: Summary | null
}

/** How much of a stored value the record of a run keeps. */
const RECORDED_VALUE_CHARACTERS = 2000

/**
 * The record of one run, written as the run goes: what processing did, where
 * its model calls belong and what it stored.
 */
class RunTrace {
  readonly steps: ProcessingStep[] = []
  readonly calls: ModelCall[] = []

  note(title: string, detail = '') {
    this.steps.push({ kind: 'note', title, detail })
  }

  call = (call: ModelCall) => {
    this.calls.push(call)
    this.steps.push({ kind: 'call' })
  }

  saved(target: string, value: string | number | boolean | null) {
    const text = value === null ? 'null' : String(value)
    this.steps.push({
      kind: 'saved',
      target,
      value:
        text.length > RECORDED_VALUE_CHARACTERS
          ? `${text.slice(0, RECORDED_VALUE_CHARACTERS)}…\n(${fill(cs.trace.characters, { count: text.length })})`
          : text,
    })
  }
}

/** Runs `work` over `items` with at most `limit` running at once, keeping the order of results. */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * A PDF is read page by page. A page of plain text is read directly from its
 * text layer. A page without a text layer, and a page whose text comes with a
 * table or a picture, is cut out and read by the model. Nothing is skipped, so
 * a document that mixes all three comes out whole.
 */
async function readPdf(
  original: Buffer,
  row: DocumentRow,
  reader: DocumentReader,
  trace: RunTrace,
): Promise<Extracted> {
  let layouts: PageLayout[]
  try {
    layouts = await readPages(original)
  } catch {
    throw new ProcessingError(cs.processing.unreadablePdf)
  }
  if (layouts.length > MAX_PDF_PAGES) {
    throw new ProcessingError(fill(cs.processing.tooManyPages, { count: MAX_PDF_PAGES }))
  }

  // How each page is read: a scan and a page with a table or a picture go to the model.
  const kinds = layouts.map((layout) =>
    !hasTextLayer(layout.text)
      ? ('scanned' as const)
      : layout.pictures > 0 || layout.hasTable
        ? ('mixed' as const)
        : ('plain' as const),
  )
  const amount = (kind: (typeof kinds)[number]) => kinds.filter((item) => item === kind).length
  trace.note(
    cs.trace.layout,
    [
      fill(cs.trace.layoutSummary, {
        pages: layouts.length,
        plain: amount('plain'),
        mixed: amount('mixed'),
        scanned: amount('scanned'),
      }),
      '',
      ...layouts.map((layout, index) => {
        const page = index + 1
        if (kinds[index] === 'scanned') return fill(cs.trace.pageScanned, { page })
        if (kinds[index] === 'plain') return fill(cs.trace.pagePlain, { page })
        const what = [
          layout.hasTable ? cs.trace.table : null,
          layout.pictures > 0 ? fill(cs.trace.pictures, { count: layout.pictures }) : null,
        ].filter((item) => item !== null)
        return fill(cs.trace.pageMixed, { page, what: what.join(', ') })
      }),
    ].join('\n'),
  )

  const layers = layouts.map((layout) => layout.text)
  const forModel = kinds.flatMap((kind, index) => (kind === 'plain' ? [] : [index]))
  if (forModel.length > 0) {
    const cut = await pageCutter(original)
    const read = await mapLimited(forModel, OCR_CONCURRENCY, async (index) => {
      const page = index + 1
      if (kinds[index] === 'scanned') return reader.readPage(await cut(index), page)
      // A page with a text layer is never lost: when the model fails, the layer is used as it is.
      try {
        const text = await reader.readMixedPage(await cut(index), page, layers[index] ?? '')
        return text === '' ? (layers[index] ?? '') : text
      } catch (error) {
        trace.note(
          fill(cs.trace.mixedFailed, { page }),
          fill(cs.trace.mixedFailedDetail, {
            reason: error instanceof Error ? error.message : String(error),
          }),
        )
        return layers[index] ?? ''
      }
    })
    forModel.forEach((pageIndex, position) => {
      layers[pageIndex] = read[position] ?? ''
    })
  }

  const text = layers.filter((page) => page !== '').join('\n\n')
  if (text === '') trace.note(cs.trace.noSummary)
  return {
    text,
    pages: layers.map((layer, index) => ({ page: index + 1, text: layer })),
    pageCount: layers.length,
    summary: text === '' ? null : await reader.summarize(text, row.originalFilename),
  }
}

async function readImage(
  original: Buffer,
  row: DocumentRow,
  reader: DocumentReader,
): Promise<Extracted> {
  const { description, ...summary } = await reader.describeImage(original, row.originalFilename)
  const text = description.trim()
  return { text, pages: [{ page: null, text }], pageCount: null, summary }
}

/**
 * Asks the decision model for the category. A failure here does not fail the
 * document: it keeps the category it has and the failed call stays in the records.
 */
async function categorize(
  document: CategorizedDocument,
  available: readonly CategoryChoice[],
  record: RecordCall,
  skills: readonly LoadedSkill[],
): Promise<string | null> {
  const categorizer = getCategorizer()
  if (categorizer === null || available.length === 0) return null
  const guidance = instructionsFor(skills, 'categorize')
  const head = {
    operation: 'categorize' as const,
    skillKey: 'categorize',
    skills: guidance.skills,
    page: null,
    // The record shows what the model decided from: the document and the wording of each category.
    input: [
      guidance.text,
      '',
      '--- Zadání ---',
      document.title,
      document.description,
      '',
      cs.trace.criteria,
      ...Object.entries(categoryCriteria(available)).map(
        ([name, criterion]) => `${name}: ${criterion}`,
      ),
    ].join('\n'),
  }
  try {
    return await recorded(record, modelName('decision'), head, async () => {
      const { category, probabilities, model, ...usage } = await categorizer(
        document,
        available,
        guidance.text,
      )
      return {
        value: category,
        output: JSON.stringify({ category, probabilities }, null, 2),
        usage,
        model,
      }
    })
  } catch (error) {
    console.error('The category of a document was not determined:', error)
    return null
  }
}

function validYear(year: number | null): number | null {
  return year !== null && year >= 1000 && year <= new Date().getFullYear() + 1 ? year : null
}

/**
 * Takes the document for processing. Only one caller gets it: the update
 * matches a document that is not being processed, or whose run went stale.
 */
async function claim(id: string): Promise<DocumentRow | undefined> {
  const [row] = await getDatabase()
    .update(documents)
    .set({ status: 'processing', errorReason: null, processingStartedAt: new Date() })
    .where(
      and(
        eq(documents.id, id),
        or(
          ne(documents.status, 'processing'),
          sql`${documents.processingStartedAt} is null`,
          lt(
            documents.processingStartedAt,
            sql`now() - make_interval(mins => ${STALE_AFTER_MINUTES})`,
          ),
        ),
      ),
    )
    .returning()
  return row
}

/**
 * Reads the content of one document and writes what it found. The document is
 * `ready` (and public) only when all of it went well; otherwise it is `failed`
 * with a reason and can be processed again.
 */
export async function processDocument(id: string): Promise<void> {
  const row = await claim(id)
  if (row === undefined) return
  const database = getDatabase()
  const started = Date.now()
  const trace = new RunTrace()
  const calls = trace.calls
  let failure: string | null = null

  try {
    const missing = missingKey('ocr') ?? missingKey('description') ?? missingKey('embedding')
    if (missing !== null)
      throw new ProcessingError(fill(cs.processing.noKey, { variable: missing }))

    const available = await database.select().from(categories)
    const skills = await loadSkills()
    const reader = getReader(skills, trace.call)
    const original = await getStorage().readAll(row.storageKey)
    if (original === null) throw new ProcessingError(cs.processing.fileMissing)
    trace.note(
      cs.trace.file,
      fill(cs.trace.fileDetail, {
        key: row.storageKey,
        size: original.byteLength,
        format: row.mimeType,
      }),
    )

    const extracted =
      row.format === 'pdf'
        ? await readPdf(original, row, reader, trace)
        : await readImage(original, row, reader)
    const summary = extracted.summary

    // The administrator may have edited the document while it was being read.
    const [current] = await database.select().from(documents).where(eq(documents.id, id))
    if (current === undefined) return

    const title = summary?.title.trim().slice(0, 300) ?? ''
    // The file name stays visible next to the name, so nothing is lost by replacing it.
    const renamed = current.titleSource !== 'manual' && title !== ''
    // A whole date says the year too; a date outside the years a document may carry is dropped.
    const day = calendarDay(summary?.issuedOn ?? null)
    const issuedOn = day !== null && validYear(Number(day.slice(0, 4))) !== null ? day : null
    const year =
      issuedOn === null ? validYear(summary?.issuedYear ?? null) : Number(issuedOn.slice(0, 4))
    const dated = current.issuedYearSource !== 'manual' && year !== null
    // A category the administrator chose stays; otherwise the decision model picks one.
    if (current.categorySource === 'manual') trace.note(cs.trace.categoryKept)
    else if (extracted.text === '') trace.note(cs.trace.categoryNoText)
    const chosen =
      current.categorySource === 'manual' || extracted.text === ''
        ? null
        : await categorize(
            {
              title: renamed ? title : current.title,
              filename: row.originalFilename,
              description: summary?.shortDescription ?? '',
              text: extracted.text,
            },
            available,
            trace.call,
            skills,
          )
    const category = available.find((candidate) => candidate.name === chosen)
    const filed = category !== undefined
    if (current.categorySource !== 'manual' && extracted.text !== '' && !filed) {
      trace.note(cs.trace.category, cs.trace.categoryUnknown)
    }

    // Pieces for the chat, under the name the document ends up with.
    const chunks = await prepareChunks(
      { id, title: renamed ? title : current.title },
      extracted.pages,
      getEmbedder(),
    )
    trace.note(
      cs.trace.chunks,
      chunks.model === null
        ? cs.trace.chunksNone
        : fill(cs.trace.chunksDetail, { count: chunks.rows.length, model: chunks.model }),
    )
    if (chunks.call !== null) trace.call(chunks.call)

    // The document and its pieces change together, so the chat never reads half of each.
    await database.transaction(async (transaction) => {
      await transaction
        .update(documents)
        .set({
          status: 'ready',
          autoDescription: extracted.text,
          shortDescription: summary?.shortDescription.trim() ?? '',
          hasText: extracted.text !== '',
          pageCount: extracted.pageCount,
          ...(renamed ? { title, titleSource: 'auto' as const } : {}),
          ...(dated ? { issuedYear: year, issuedOn, issuedYearSource: 'auto' as const } : {}),
          ...(filed ? { categoryId: category.id, categorySource: 'auto' as const } : {}),
        })
        .where(eq(documents.id, id))
      await writeChunks(transaction, id, chunks.rows)
    })

    trace.saved('documents.status', 'ready')
    trace.saved('documents.auto_description', extracted.text)
    trace.saved('documents.short_description', summary?.shortDescription.trim() ?? '')
    trace.saved('documents.has_text', extracted.text !== '')
    trace.saved('documents.page_count', extracted.pageCount)
    if (renamed) {
      trace.saved('documents.title', title)
      trace.saved('documents.title_source', 'auto')
    }
    if (dated) {
      trace.saved('documents.issued_year', year)
      trace.saved('documents.issued_on', issuedOn)
      trace.saved('documents.issued_year_source', 'auto')
    }
    if (filed) {
      trace.saved('documents.category_id', `${category.id} (${category.name})`)
      trace.saved('documents.category_source', 'auto')
    }
    trace.saved('document_chunks', fill(cs.trace.rows, { count: chunks.rows.length }))
    const kept = [
      renamed ? null : current.titleSource === 'manual' ? cs.trace.titleKept : cs.trace.titleEmpty,
      dated
        ? null
        : current.issuedYearSource === 'manual'
          ? cs.trace.yearKept
          : cs.trace.yearUnknown,
    ].filter((line) => line !== null)
    if (kept.length > 0) trace.note(cs.trace.kept, kept.join('\n'))
  } catch (error) {
    if (!(error instanceof ProcessingError)) console.error(`Processing of ${id} failed:`, error)
    failure = error instanceof ProcessingError ? error.message : cs.processing.aiFailed
    trace.note(
      cs.trace.failed,
      error instanceof ProcessingError || !(error instanceof Error)
        ? failure
        : `${failure}\n${error.message}`,
    )
    await database
      .update(documents)
      .set({ status: 'failed', errorReason: failure })
      .where(eq(documents.id, id))
    trace.saved('documents.status', 'failed')
    trace.saved('documents.error_reason', failure)
  } finally {
    const runId = randomUUID()
    // Calls made before a failure were paid for too.
    await recordCalls(row, calls, runId).catch((error: unknown) => {
      console.error(`Usage of ${id} was not recorded:`, error)
    })
    // The document may have been removed while it was being read; then there is nothing to hang the run on.
    await database
      .insert(processingRuns)
      .values({
        id: runId,
        documentId: id,
        outcome: failure === null ? 'ready' : 'failed',
        error: failure,
        steps: trace.steps,
        durationMs: Date.now() - started,
      })
      .catch(() => {})
  }
}

/**
 * Picks the category of a document that is already processed, from its stored
 * text. A category the administrator chose stays. Returns the name it filed
 * the document under, or `null` when nothing changed.
 */
export async function categorizeDocument(id: string): Promise<string | null> {
  const database = getDatabase()
  const [row] = await database.select().from(documents).where(eq(documents.id, id))
  if (row === undefined || row.categorySource === 'manual' || row.autoDescription === '') {
    return null
  }
  const available = await database.select().from(categories)
  const calls: ModelCall[] = []
  const chosen = await categorize(
    {
      title: row.title,
      filename: row.originalFilename,
      description: row.shortDescription,
      text: row.autoDescription,
    },
    available,
    (call) => calls.push(call),
    await loadSkills(),
  )
  const category = available.find((candidate) => candidate.name === chosen)
  if (category !== undefined) {
    await database
      .update(documents)
      .set({ categoryId: category.id, categorySource: 'auto' })
      .where(eq(documents.id, id))
  }
  await recordCalls(row, calls, randomUUID())
  return category?.name ?? null
}

/** The calls of one run form one session, under `runId`. */
async function recordCalls(row: DocumentRow, calls: readonly ModelCall[], runId: string) {
  if (calls.length === 0) return
  // The document may have been removed while it was being read.
  const [current] = await getDatabase()
    .select({ title: documents.title })
    .from(documents)
    .where(eq(documents.id, row.id))
  await storeCalls(
    {
      runId,
      documentId: current === undefined ? null : row.id,
      title: current?.title ?? row.title,
      format: row.format,
    },
    calls,
  )
}
