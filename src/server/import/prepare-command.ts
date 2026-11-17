import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { detectFormat } from '../../archive/upload'
import { hasTextLayer, readPages } from '../pdf-text'
import type { PreparedDocument, PreparedPage } from './work'

// `pnpm import:prepare <folder> <work folder>` — the first half of a bulk
// import that is read by a person or an agent instead of the models from `.env`.
// For every PDF and image under <folder> it writes into <work folder>:
//   <id>.json        everything `import:load` needs, with the text layer of each page
//   <id>.head.txt    what a reader needs: the file, its pages and the start of its text
//   <id>.vision.pdf  only the pages a reader must look at (scans, pages with a table or a picture)
// The reader then writes <id>.result.json (see `ReadDocument` in `work.ts`).

/** How much of the text a reader gets to name and describe the document. */
const HEAD_CHARACTERS = 6000

const [folderArgument, workArgument] = process.argv.slice(2)
if (folderArgument === undefined || workArgument === undefined) {
  throw new Error('Usage: pnpm import:prepare <folder> <work folder>')
}
const folder = resolve(folderArgument)
const work = resolve(workArgument)
mkdirSync(work, { recursive: true })

function filesUnder(directory: string): string[] {
  return readdirSync(directory)
    .sort((first, second) => first.localeCompare(second))
    .flatMap((name) => {
      const path = join(directory, name)
      return statSync(path).isDirectory() ? filesUnder(path) : [path]
    })
}

const skipped: string[] = []
const prepared: PreparedDocument[] = []
for (const source of filesUnder(folder)) {
  const original = readFileSync(source)
  const detected = detectFormat(original.subarray(0, 16))
  if (detected === null) {
    skipped.push(relative(folder, source))
    continue
  }
  const id = String(prepared.length + 1).padStart(3, '0')

  let pages: PreparedPage[] = []
  if (detected.format === 'pdf') {
    pages = (await readPages(original)).map((layout, index) => ({
      page: index + 1,
      kind: !hasTextLayer(layout.text)
        ? 'scanned'
        : layout.pictures > 0 || layout.hasTable
          ? 'mixed'
          : 'plain',
      ...layout,
    }))
  }
  const visionPages = pages.filter((page) => page.kind !== 'plain').map((page) => page.page)
  if (visionPages.length > 0) {
    const whole = await PDFDocument.load(original, { ignoreEncryption: true })
    const cut = await PDFDocument.create()
    for (const page of await cut.copyPages(
      whole,
      visionPages.map((page) => page - 1),
    )) {
      cut.addPage(page)
    }
    writeFileSync(join(work, `${id}.vision.pdf`), await cut.save())
  }

  const document: PreparedDocument = {
    id,
    source,
    relative: relative(folder, source),
    filename: basename(source),
    format: detected.format,
    mimeType: detected.mimeType,
    sha256: createHash('sha256').update(original).digest('hex'),
    pages,
    visionPages,
  }
  prepared.push(document)
  writeFileSync(join(work, `${id}.json`), JSON.stringify(document, null, 1))

  const text = pages
    .map((page) => page.text)
    .filter((layer) => layer !== '')
    .join('\n\n')
  writeFileSync(
    join(work, `${id}.head.txt`),
    [
      `id: ${id}`,
      `file: ${document.relative}`,
      `format: ${document.format}`,
      `pages: ${pages.length}`,
      document.format === 'image' ? `image to look at: ${source}` : null,
      visionPages.length === 0
        ? 'pages to look at: none'
        : `pages to look at: ${join(work, `${id}.vision.pdf`)}`,
      ...visionPages.map((page, index) => {
        const kind = pages[page - 1]?.kind
        return `  page ${index + 1} of the vision PDF = page ${page} of the document (${kind})`
      }),
      '',
      `--- start of the text layer (${text.length} characters in all) ---`,
      text.slice(0, HEAD_CHARACTERS),
    ]
      .filter((line) => line !== null)
      .join('\n'),
  )
}

writeFileSync(join(work, 'skipped.txt'), skipped.join('\n'))
const visionTotal = prepared.reduce((sum, document) => sum + document.visionPages.length, 0)
console.log(
  `Prepared ${prepared.length} files, ${visionTotal} pages to look at. Skipped ${skipped.length} files of another kind.`,
)
