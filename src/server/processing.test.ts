import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelCall } from '../ai/types'
import { cs } from '../copy/cs'
import type { CategoryRow, DocumentRow } from '../db/schema'
import { defaultSkills } from './ai/skills'
import type { ChunkRow } from './chat/index-service'
import { processDocument, type ProcessingWorld } from './processing'
import type { ProcessingStore, RunRecord } from './processing-store'

// A document is processed here the way the application processes it, with the
// stand-in models of the test suite. Only what a run reaches outside itself
// for is replaced: the archive is kept in memory and the file is a buffer.

const CATEGORIES: CategoryRow[] = [
  {
    id: 'zapisy',
    name: 'Zápisy',
    description: '',
    color: '#2f6f4f',
    position: 1,
    isFallback: false,
  },
  {
    id: 'nezarazene',
    name: 'Nezařazené',
    description: '',
    color: '#6b7280',
    position: 2,
    isFallback: true,
  },
]

/** A document as an upload leaves it. */
function uploaded(changes: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'dokument-1',
    originalFilename: 'foto-kostel.jpg',
    title: 'foto-kostel',
    titleSource: 'filename',
    format: 'image',
    mimeType: 'image/jpeg',
    sizeBytes: 4,
    sha256: 'a'.repeat(64),
    storageKey: 'originals/dokument-1',
    thumbnailKey: null,
    categoryId: 'nezarazene',
    categorySource: 'default',
    addedAt: new Date('2026-11-24T10:00:00Z'),
    issuedYear: null,
    issuedOn: null,
    issuedYearSource: null,
    customDescription: '',
    extractedText: '',
    shortDescription: '',
    status: 'queued',
    processingStartedAt: null,
    hasText: null,
    errorReason: null,
    pageCount: null,
    searchVector: '',
    ...changes,
  }
}

/** The archive of one document, kept in memory. */
function memoryArchive(start: DocumentRow) {
  const archive = {
    document: start as DocumentRow | undefined,
    chunks: [] as ChunkRow[],
    runs: [] as { run: RunRecord; calls: ModelCall[] }[],
  }
  const store: ProcessingStore = {
    claim: async (id) => {
      const document = archive.document
      if (document === undefined || document.id !== id || document.status === 'processing') {
        return undefined
      }
      archive.document = { ...document, status: 'processing', errorReason: null }
      return archive.document
    },
    current: async () => archive.document,
    categories: async () => CATEGORIES,
    finish: async (_id, values, chunks) => {
      archive.document = { ...(archive.document as DocumentRow), ...values }
      archive.chunks = [...chunks]
    },
    fail: async (_id, reason) => {
      archive.document = {
        ...(archive.document as DocumentRow),
        status: 'failed',
        errorReason: reason,
      }
    },
    keepRun: async (_document, run, calls) => {
      archive.runs.push({ run, calls: [...calls] })
    },
  }
  return { archive, store }
}

/** A PDF of one page with one line of plain text. */
async function pdf(line: string): Promise<Buffer> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  document.addPage([595, 842]).drawText(line, { x: 50, y: 780, size: 12, font })
  return Buffer.from(await document.save())
}

/** Processes `start` from `file` and gives back what the archive holds then. */
async function processed(
  start: DocumentRow,
  file: Buffer | null = Buffer.from('foto'),
  /** Something that happens in the archive while the file is being read. */
  meanwhile: (archive: ReturnType<typeof memoryArchive>['archive']) => void = () => {},
) {
  const { archive, store } = memoryArchive(start)
  const world: ProcessingWorld = {
    store,
    original: async () => {
      meanwhile(archive)
      return file
    },
    skills: async () => defaultSkills(),
  }
  await processDocument(start.id, world)
  return archive
}

const operations = (calls: readonly ModelCall[]) => calls.map((call) => call.operation)

describe('a processing run', () => {
  beforeEach(() => {
    vi.stubEnv('AI_OCR_MODEL', 'fake:test')
    vi.stubEnv('AI_DESCRIPTION_MODEL', 'fake:description')
    vi.stubEnv('AI_EMBEDDING_MODEL', 'fake:embedding')
    vi.stubEnv('AI_DECISION_MODEL', 'fake:decision')
    vi.stubEnv(
      'AI_PRICES',
      '{"fake:test":[1,2],"fake:description":[2,4],"fake:embedding":[1,0],"fake:decision":[1,0]}',
    )
    // A run that fails says so on the console, as a real failure would.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('reads an image, names it from its content and publishes it', async () => {
    const archive = await processed(uploaded())

    expect(archive.document).toMatchObject({
      status: 'ready',
      title: 'foto-kostel (název z obsahu)',
      titleSource: 'auto',
      extractedText: 'Zkušební popis obrázku ze souboru foto-kostel.jpg. Popis má několik vět.',
      shortDescription: 'Zkušební krátký popis obrázku foto-kostel.jpg.',
      hasText: true,
      pageCount: null,
      categoryId: 'nezarazene',
      categorySource: 'default',
    })
    // The pieces for the chat carry the name the document ended up with.
    expect(archive.chunks).toHaveLength(1)
    expect(archive.chunks[0]?.indexed).toContain('foto-kostel (název z obsahu)')
    expect(archive.runs).toHaveLength(1)
    expect(archive.runs[0]?.run).toMatchObject({ outcome: 'ready', error: null })
    expect(operations(archive.runs[0]?.calls ?? [])).toEqual([
      'describe-image',
      'categorize',
      'embed',
    ])
  })

  it('reads a page of plain text of a PDF without a model, and dates the document', async () => {
    const archive = await processed(
      uploaded({ originalFilename: 'kronika.pdf', format: 'pdf', mimeType: 'application/pdf' }),
      await pdf('Kronika obce z roku 1998 a dalsi text strany.'),
    )

    expect(archive.document).toMatchObject({
      status: 'ready',
      pageCount: 1,
      issuedYear: 1998,
      issuedOn: null,
      issuedYearSource: 'auto',
    })
    expect(archive.document?.extractedText).toContain('Kronika obce z roku 1998')
    expect(operations(archive.runs[0]?.calls ?? [])).toEqual(['summarize', 'categorize', 'embed'])
  })

  it('files a document in the category the decision model chose', async () => {
    const archive = await processed(uploaded({ originalFilename: 'zapis-foto.jpg' }))

    expect(archive.document).toMatchObject({ categoryId: 'zapisy', categorySource: 'auto' })
    expect(archive.runs[0]?.run.steps).toContainEqual({
      kind: 'saved',
      target: 'documents.category_id',
      value: 'zapisy (Zápisy)',
    })
  })

  it('leaves the name and the category the administrator typed', async () => {
    const archive = await processed(
      uploaded({
        originalFilename: 'zapis-foto.jpg',
        title: 'Název od správce',
        titleSource: 'manual',
        categorySource: 'manual',
      }),
    )

    expect(archive.document).toMatchObject({
      status: 'ready',
      title: 'Název od správce',
      titleSource: 'manual',
      categoryId: 'nezarazene',
      categorySource: 'manual',
    })
    // The decision model is not asked for a category it may not write.
    expect(operations(archive.runs[0]?.calls ?? [])).toEqual(['describe-image', 'embed'])
    expect(archive.runs[0]?.run.steps).toContainEqual({
      kind: 'note',
      title: cs.trace.categoryKept,
      detail: '',
    })
    expect(archive.chunks[0]?.indexed).toContain('Název od správce')
  })

  it('leaves a name the administrator typed while the file was being read', async () => {
    const archive = await processed(uploaded(), Buffer.from('foto'), (held) => {
      held.document = { ...(held.document as DocumentRow), title: 'Mezitím', titleSource: 'manual' }
    })

    expect(archive.document).toMatchObject({
      status: 'ready',
      title: 'Mezitím',
      titleSource: 'manual',
    })
  })

  it('does not publish a document whose reading failed, and keeps the run and its calls', async () => {
    const archive = await processed(uploaded({ originalFilename: 'selhani.jpg' }))

    expect(archive.document).toMatchObject({
      status: 'failed',
      errorReason: cs.processing.aiFailed,
      extractedText: '',
    })
    expect(archive.chunks).toEqual([])
    expect(archive.runs[0]?.run).toMatchObject({
      outcome: 'failed',
      error: cs.processing.aiFailed,
    })
    // The call that failed was made, so it stays in the records.
    expect(archive.runs[0]?.calls).toMatchObject([
      { operation: 'describe-image', error: 'The fake reader was asked to fail.' },
    ])
  })

  it('fails with a reason the administrator can act on when the file is gone', async () => {
    const archive = await processed(uploaded(), null)

    expect(archive.document).toMatchObject({
      status: 'failed',
      errorReason: cs.processing.fileMissing,
    })
    expect(archive.runs[0]?.calls).toEqual([])
  })

  it('leaves a document alone that another run is processing', async () => {
    const archive = await processed(uploaded({ status: 'processing' }))

    expect(archive.document).toMatchObject({ status: 'processing', title: 'foto-kostel' })
    expect(archive.runs).toEqual([])
  })

  it('processes a failed document again', async () => {
    const archive = await processed(
      uploaded({ status: 'failed', errorReason: cs.processing.aiFailed }),
    )

    expect(archive.document).toMatchObject({ status: 'ready', errorReason: null })
  })
})
