import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { calendarDay } from '../../archive/query'
import { closeDatabase, getDatabase } from '../../db/client'
import { categories, documents, processingRuns } from '../../db/schema'
import type { ProcessingStep } from '../../processing/types'
import { storeCalls } from '../ai/calls'
import type { PageText } from '../chat/chunks'
import { getEmbedder } from '../chat/embedder'
import { prepareChunks, writeChunks } from '../chat/index-service'
import { getStorage, originalKey } from '../storage'
import { makeThumbnail } from '../thumbnail'
import type { PreparedDocument, ReadDocument } from './work'

// `pnpm import:load <work folder> [reader]` — the second half of a bulk import.
// Stores every file of the work folder that has a `<id>.result.json` and is
// not in the archive yet: the original, the record, the pieces for the chat
// and a record of the run for the debug panel. Only the embedding is paid for.
// A file whose result is missing or wrong is reported and left for the next run.

const [workArgument, reader = 'Claude Code'] = process.argv.slice(2)
if (workArgument === undefined) throw new Error('Usage: pnpm import:load <work folder> [reader]')
const work = resolve(workArgument)

const database = getDatabase()
const storage = getStorage()
const embed = getEmbedder()
const available = await database.select().from(categories)

/** Why a result cannot be stored, or `null` when it can. */
function problemOf(prepared: PreparedDocument, read: ReadDocument): string | null {
  if (typeof read.title !== 'string' || read.title.trim() === '') return 'no title'
  if (read.title.length > 300) return 'title longer than 300 characters'
  if (typeof read.shortDescription !== 'string' || read.shortDescription.trim() === '') {
    return 'no short description'
  }
  if (read.issuedYear !== null && !Number.isInteger(read.issuedYear)) return 'year is not a number'
  if (
    read.issuedYear !== null &&
    (read.issuedYear < 1000 || read.issuedYear > new Date().getFullYear() + 1)
  ) {
    return `year ${read.issuedYear} is out of range`
  }
  if (!available.some((category) => category.id === read.category)) {
    return `unknown category "${read.category}"`
  }
  if (prepared.format === 'image') {
    return typeof read.description === 'string' && read.description.trim() !== ''
      ? null
      : 'no description of the image'
  }
  for (const page of prepared.visionPages) {
    const text = read.pages?.[String(page)]
    if (typeof text !== 'string') return `page ${page} was not read`
    const kind = prepared.pages[page - 1]?.kind
    if (kind === 'scanned' && text.trim() === '') return `scanned page ${page} has no text`
  }
  const extra = Object.keys(read.pages ?? {}).find(
    (page) => !prepared.visionPages.includes(Number(page)),
  )
  return extra === undefined ? null : `page ${extra} was not to be read`
}

let stored = 0
let present = 0
const waiting: string[] = []
const refused: string[] = []

const ids = readdirSync(work)
  .filter((name) => /^\d+\.json$/.test(name))
  .map((name) => name.replace('.json', ''))
  .sort()

for (const id of ids) {
  const prepared = JSON.parse(readFileSync(join(work, `${id}.json`), 'utf8')) as PreparedDocument
  const [existing] = await database
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.sha256, prepared.sha256))
  if (existing !== undefined) {
    present += 1
    continue
  }
  const resultPath = join(work, `${id}.result.json`)
  if (!existsSync(resultPath)) {
    waiting.push(id)
    continue
  }
  let read: ReadDocument
  try {
    read = JSON.parse(readFileSync(resultPath, 'utf8')) as ReadDocument
  } catch {
    refused.push(`${id} ${prepared.relative}: the result is not JSON`)
    continue
  }
  const problem = problemOf(prepared, read)
  if (problem !== null) {
    refused.push(`${id} ${prepared.relative}: ${problem}`)
    continue
  }

  const started = Date.now()
  const steps: ProcessingStep[] = []
  const note = (title: string, detail = '') => steps.push({ kind: 'note', title, detail })
  const saved = (target: string, value: string | number | boolean | null) => {
    const text = value === null ? 'null' : String(value)
    steps.push({
      kind: 'saved',
      target,
      value: text.length > 2000 ? `${text.slice(0, 2000)}…\n(${text.length} znaků)` : text,
    })
  }

  // The text of the document, page by page: the text layer, and what the reader added to it.
  const pages: PageText[] =
    prepared.format === 'image'
      ? [{ page: null, text: (read.description ?? '').trim() }]
      : prepared.pages.map((page) => {
          const added = (read.pages?.[String(page.page)] ?? '').trim()
          const text =
            page.kind === 'scanned'
              ? added
              : [page.text, added].filter((part) => part !== '').join('\n\n')
          return { page: page.page, text }
        })
  const text = pages
    .map((page) => page.text)
    .filter((page) => page !== '')
    .join('\n\n')
  const category = available.find((candidate) => candidate.id === read.category)
  if (category === undefined) throw new Error('The category was checked above.')
  const title = read.title.trim()
  const issuedOn = calendarDay(read.issuedOn ?? null)

  note(
    'Hromadný import',
    `Dokument nečetly modely z nastavení aplikace. Přečetl ho ${reader} a hodnoty zapsal příkaz import:load.\nZdroj: ${prepared.relative}`,
  )
  if (prepared.format === 'pdf') {
    const amount = (kind: string) => prepared.pages.filter((page) => page.kind === kind).length
    note(
      'Rozbor stran PDF',
      [
        `Stran: ${prepared.pages.length}`,
        `Jen text (textová vrstva, beze změny): ${amount('plain')}`,
        `Text s tabulkou nebo obrázkem (textová vrstva + doplnění od čtenáře): ${amount('mixed')}`,
        `Bez textu, sken (celý přepis od čtenáře): ${amount('scanned')}`,
        '',
        ...prepared.pages
          .filter((page) => page.kind !== 'plain')
          .map((page) => {
            const added = (read.pages?.[String(page.page)] ?? '').trim()
            return `Strana ${page.page} (${page.kind === 'scanned' ? 'sken' : 'text s tabulkou nebo obrázkem'}): čtenář zapsal ${added.length} znaků.`
          }),
      ].join('\n'),
    )
  }

  const documentId = randomUUID()
  const original = readFileSync(prepared.source)
  const storageKey = await storage.write(originalKey(documentId), original, prepared.mimeType)
  let thumbnailKey: string | null = null
  if (prepared.format === 'image') {
    const thumbnail = await makeThumbnail(original)
    if (thumbnail !== null) {
      thumbnailKey = await storage.write(`thumbnails/${documentId}.webp`, thumbnail, 'image/webp')
    }
  }

  try {
    const chunks = await prepareChunks({ id: documentId, title }, pages, embed)
    note(
      'Rozdělení na kousky pro chat',
      chunks.model === null
        ? 'Dokument nemá text, žádné kousky nevznikly.'
        : `Kousků: ${chunks.rows.length}\nModel pro embedding: ${chunks.model}`,
    )
    if (chunks.call !== null) steps.push({ kind: 'call' })

    const runId = randomUUID()
    await database.transaction(async (transaction) => {
      await transaction.insert(documents).values({
        id: documentId,
        originalFilename: prepared.filename,
        title,
        titleSource: 'auto',
        format: prepared.format,
        mimeType: prepared.mimeType,
        sizeBytes: original.byteLength,
        sha256: prepared.sha256,
        storageKey,
        thumbnailKey,
        categoryId: category.id,
        categorySource: 'auto',
        issuedYear: issuedOn === null ? read.issuedYear : Number(issuedOn.slice(0, 4)),
        issuedOn,
        issuedYearSource: read.issuedYear === null ? null : 'auto',
        extractedText: text,
        shortDescription: read.shortDescription.trim(),
        status: 'ready',
        hasText: text !== '',
        pageCount: prepared.format === 'pdf' ? prepared.pages.length : null,
      })
      await writeChunks(transaction, documentId, chunks.rows)
      if (chunks.call !== null) {
        await storeCalls(
          { runId, documentId, title, format: prepared.format },
          [chunks.call],
          transaction,
        )
      }

      saved('documents.status', 'ready')
      saved('documents.storage_key', storageKey)
      saved('documents.title', title)
      saved('documents.title_source', 'auto')
      saved('documents.short_description', read.shortDescription.trim())
      saved('documents.issued_year', read.issuedYear)
      saved('documents.issued_on', issuedOn)
      saved('documents.category_id', `${category.id} (${category.name})`)
      saved('documents.category_source', 'auto')
      saved('documents.auto_description', text)
      saved('documents.has_text', text !== '')
      saved('documents.page_count', prepared.format === 'pdf' ? prepared.pages.length : null)
      saved('document_chunks', `${chunks.rows.length} řádků`)
      await transaction.insert(processingRuns).values({
        id: runId,
        documentId,
        outcome: 'ready',
        steps,
        durationMs: Date.now() - started,
      })
    })
    stored += 1
    console.log(`${id} stored: ${title}`)
  } catch (error) {
    // Nothing of a document that was not recorded may stay in storage.
    await storage.remove(storageKey)
    if (thumbnailKey !== null) await storage.remove(thumbnailKey)
    refused.push(
      `${id} ${prepared.relative}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

console.log(
  `\nStored ${stored}. Already in the archive ${present}. Waiting for a result ${waiting.length}. Refused ${refused.length}.`,
)
if (waiting.length > 0) console.log(`Waiting: ${waiting.join(' ')}`)
for (const line of refused) console.log(`Refused: ${line}`)
await closeDatabase()
