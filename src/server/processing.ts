import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { cs, fill } from '../copy/cs'
import { getDatabase } from '../db/client'
import { categories, documents, type DocumentRow } from '../db/schema'
import type { ProcessingStep } from '../processing/types'
import { recorded, type ModelCall, type RecordCall } from './ai/calls'
import {
  categoryCriteria,
  getCategorizer,
  type CategorizedDocument,
  type CategoryChoice,
} from './ai/categorizer'
import { missingKey, modelName } from './ai/models'
import { getReader, type DocumentReader } from './ai/reader'
import { instructionsFor, type LoadedSkill } from './ai/skills'
import type { PageText } from './chat/chunks'
import { getEmbedder } from './chat/embedder'
import { prepareChunks } from './chat/index-service'
import { byProcessing, categoryChoice, titleAfter, type Found } from './document-changes'
import { hasTextLayer, pageCutter, readPages, type PageLayout } from './pdf-text'
import { keepCalls, postgresStore, type ProcessingStore } from './processing-store'
import { loadSkills } from './skills-service'
import { getStorage } from './storage'

export const MAX_PDF_PAGES = 300
/** Scanned pages read at the same time. */
const OCR_CONCURRENCY = 3
/** A failure whose reason the administrator can read and act on. */
class ProcessingError extends Error {}

interface Extracted extends Found {
  /** The text of the document page by page; the chat searches in pieces of it. */
  pages: PageText[]
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
    use: 'categorize',
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

/**
 * What a processing run reaches outside itself for. The application gives the
 * archive in Postgres and its file storage; the tests of a run give their own.
 * The models are the ones the settings name, as everywhere.
 */
export interface ProcessingWorld {
  store: ProcessingStore
  /** The original of a document from file storage; `null` when it is not there. */
  original: (storageKey: string) => Promise<Buffer | null>
  /** The skills in force now (see `loadSkills`). */
  skills: () => Promise<LoadedSkill[]>
}

/** What the application processes: the documents in Postgres and their files in storage. */
const ARCHIVE: ProcessingWorld = {
  store: postgresStore,
  original: (storageKey) => getStorage().readAll(storageKey),
  skills: () => loadSkills(),
}

/**
 * Reads the content of one document and writes what it found. The document is
 * `ready` (and published) only when all of it went well; otherwise it is `failed`
 * with a reason and can be processed again.
 */
export async function processDocument(id: string, world: ProcessingWorld = ARCHIVE): Promise<void> {
  const { store } = world
  const row = await store.claim(id)
  if (row === undefined) return
  const started = Date.now()
  const trace = new RunTrace()
  let failure: string | null = null

  try {
    const missing = missingKey('ocr') ?? missingKey('description') ?? missingKey('embedding')
    if (missing !== null)
      throw new ProcessingError(fill(cs.processing.noKey, { variable: missing }))

    const available = await store.categories()
    const skills = await world.skills()
    const reader = getReader(skills, trace.call)
    const original = await world.original(row.storageKey)
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
    const current = await store.current(id)
    if (current === undefined) return

    const title = titleAfter(current, summary)
    // A category the administrator chose stays; otherwise the decision model picks one.
    const choice = categoryChoice(current, extracted.text)
    if (choice === 'kept') trace.note(cs.trace.categoryKept)
    else if (choice === 'no-text') trace.note(cs.trace.categoryNoText)
    const chosen =
      choice === 'ask'
        ? await categorize(
            {
              title,
              filename: row.originalFilename,
              description: summary?.shortDescription ?? '',
              text: extracted.text,
            },
            available,
            trace.call,
            skills,
          )
        : null
    const category = available.find((candidate) => candidate.name === chosen)
    if (choice === 'ask' && category === undefined) {
      trace.note(cs.trace.category, cs.trace.categoryUnknown)
    }

    // Pieces for the chat, under the name the document ends up with.
    const chunks = await prepareChunks({ id, title }, extracted.pages, getEmbedder())
    trace.note(
      cs.trace.chunks,
      chunks.model === null
        ? cs.trace.chunksNone
        : fill(cs.trace.chunksDetail, { count: chunks.rows.length, model: chunks.model }),
    )
    if (chunks.call !== null) trace.call(chunks.call)

    const changes = byProcessing(current, extracted, category)
    await store.finish(id, changes.values, chunks.rows)

    for (const { target, value } of changes.saved) trace.saved(target, value)
    trace.saved('document_chunks', fill(cs.trace.rows, { count: chunks.rows.length }))
    if (changes.kept.length > 0) trace.note(cs.trace.kept, changes.kept.join('\n'))
  } catch (error) {
    if (!(error instanceof ProcessingError)) console.error(`Processing of ${id} failed:`, error)
    failure = error instanceof ProcessingError ? error.message : cs.processing.aiFailed
    trace.note(
      cs.trace.failed,
      error instanceof ProcessingError || !(error instanceof Error)
        ? failure
        : `${failure}\n${error.message}`,
    )
    await store.fail(id, failure)
    trace.saved('documents.status', 'failed')
    trace.saved('documents.error_reason', failure)
  } finally {
    await store.keepRun(
      row,
      {
        outcome: failure === null ? 'ready' : 'failed',
        error: failure,
        steps: trace.steps,
        durationMs: Date.now() - started,
      },
      trace.calls,
    )
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
  if (row === undefined || categoryChoice(row, row.extractedText) !== 'ask') return null
  const available = await database.select().from(categories)
  const calls: ModelCall[] = []
  const chosen = await categorize(
    {
      title: row.title,
      filename: row.originalFilename,
      description: row.shortDescription,
      text: row.extractedText,
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
  await keepCalls(row, calls, randomUUID())
  return category?.name ?? null
}
