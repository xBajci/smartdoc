import { PDFDocument } from 'pdf-lib'
import { extractText, getDocumentProxy, getResolvedPDFJS } from 'unpdf'

/** A page with fewer letters and digits than this in its text layer is treated as a scan. */
const MIN_LAYER_CHARACTERS = 20

export function hasTextLayer(pageText: string): boolean {
  return (pageText.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= MIN_LAYER_CHARACTERS
}

/** The text layer of every page, in page order. A scanned page gives an empty or near-empty string. */
export async function readTextLayers(pdf: Buffer): Promise<string[]> {
  // The reader takes over the bytes it is given, so it gets a copy.
  const document = await getDocumentProxy(new Uint8Array(pdf))
  try {
    const { text } = await extractText(document, { mergePages: false })
    return text.map((page) => page.trim())
  } finally {
    await document.loadingTask.destroy()
  }
}

/** What one page of a PDF holds, as far as it can be told without a model. */
export interface PageLayout {
  /** The text layer; empty or near-empty for a scan. */
  text: string
  /** Pictures that take a real part of the page; a logo or an ornament is not counted. */
  pictures: number
  /** The page has ruled lines that form a grid, i.e. a table. */
  hasTable: boolean
}

/** A picture smaller than this share of the page is taken for a logo or an ornament. */
const MIN_PICTURE_SHARE = 0.02
/** A drawn shape this thin, and at least `MIN_RULE_LENGTH` long, is a ruled line. */
const MAX_RULE_THICKNESS = 3
const MIN_RULE_LENGTH = 20
/**
 * A table has at least this many lines across, all of one length, and this many
 * lines down that cross them: a head and two rows, in two columns. One frame
 * with a line in it has fewer.
 */
const MIN_TABLE_LINES_ACROSS = 4
const MIN_TABLE_LINES_DOWN = 3
/** Two lines within this distance are taken for the same line, or for lines that touch. */
const RULE_TOLERANCE = 4

/** A ruled line: where it lies (`at`) and from where to where it runs. */
interface Rule {
  at: number
  from: number
  to: number
}

/**
 * Ruled lines make a table when several lines across share their start and
 * end, and lines down cross that band. A frame around an article, an
 * underline or a line for a signature does not pass.
 */
function formsTable(drawnAcross: readonly Rule[], drawnDown: readonly Rule[]): boolean {
  const near = (first: number, second: number) => Math.abs(first - second) <= RULE_TOLERANCE
  // A line drawn in pieces, e.g. cell by cell, is one line.
  const joined = (rules: readonly Rule[]) => {
    const lines: Rule[] = []
    for (const rule of [...rules].sort((a, b) => a.at - b.at || a.from - b.from)) {
      const last = lines.at(-1)
      if (last !== undefined && near(last.at, rule.at) && rule.from <= last.to + RULE_TOLERANCE) {
        last.to = Math.max(last.to, rule.to)
      } else lines.push({ ...rule })
    }
    return lines
  }
  const across = joined(drawnAcross)
  const down = joined(drawnDown)
  return across.some((line) => {
    const band = across.filter((other) => near(other.from, line.from) && near(other.to, line.to))
    const rows = new Set(band.map((other) => Math.round(other.at / RULE_TOLERANCE)))
    if (rows.size < MIN_TABLE_LINES_ACROSS) return false
    const bottom = Math.min(...band.map((other) => other.at))
    const top = Math.max(...band.map((other) => other.at))
    const columns = new Set(
      down
        .filter(
          (other) =>
            other.at >= line.from - RULE_TOLERANCE &&
            other.at <= line.to + RULE_TOLERANCE &&
            other.from < top &&
            other.to > bottom,
        )
        .map((other) => Math.round(other.at / RULE_TOLERANCE)),
    )
    return columns.size >= MIN_TABLE_LINES_DOWN
  })
}

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function multiply(outer: Matrix, inner: Matrix): Matrix {
  return [
    inner[0] * outer[0] + inner[1] * outer[2],
    inner[0] * outer[1] + inner[1] * outer[3],
    inner[2] * outer[0] + inner[3] * outer[2],
    inner[2] * outer[1] + inner[3] * outer[3],
    inner[4] * outer[0] + inner[5] * outer[2] + outer[4],
    inner[4] * outer[1] + inner[5] * outer[3] + outer[5],
  ]
}

function isMatrix(value: unknown): value is Matrix {
  return (
    (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    (value as ArrayLike<unknown>).length === 6
  )
}

/**
 * Every page of a PDF: its text layer, and whether it also holds pictures or a
 * ruled table. Processing sends only such mixed pages, and scans, to a model.
 */
export async function readPages(pdf: Buffer): Promise<PageLayout[]> {
  // The reader takes over the bytes it is given, so it gets a copy.
  const document = await getDocumentProxy(new Uint8Array(pdf))
  try {
    const [{ text }, { OPS }] = await Promise.all([
      extractText(document, { mergePages: false }),
      getResolvedPDFJS(),
    ])
    const layouts: PageLayout[] = []
    for (const [index, layer] of text.entries()) {
      const page = await document.getPage(index + 1)
      let shapes = { pictures: 0, hasTable: false }
      try {
        const [left = 0, bottom = 0, right = 0, top = 0] = page.view
        const { fnArray, argsArray } = await page.getOperatorList()
        shapes = pageShapes(fnArray, argsArray, OPS, Math.abs((right - left) * (top - bottom)))
      } catch {
        // A page whose drawing cannot be listed is read by its text layer alone.
      } finally {
        page.cleanup()
      }
      layouts.push({ text: layer.trim(), ...shapes })
    }
    return layouts
  } finally {
    await document.loadingTask.destroy()
  }
}

/** Walks the drawing commands of a page and counts its pictures and ruled lines. */
function pageShapes(
  commands: ArrayLike<number>,
  commandArguments: ArrayLike<unknown>,
  OPS: Record<string, number>,
  pageArea: number,
): Pick<PageLayout, 'pictures' | 'hasTable'> {
  let matrix = IDENTITY
  const saved: Matrix[] = []
  let pictures = 0
  const across: Rule[] = []
  const down: Rule[] = []

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]
    const given = commandArguments[index]
    const first: unknown = Array.isArray(given) ? given[0] : undefined

    if (command === OPS.save) saved.push(matrix)
    else if (command === OPS.restore) matrix = saved.pop() ?? matrix
    else if (command === OPS.transform && isMatrix(given)) {
      matrix = multiply(matrix, Array.from(given) as Matrix)
    } else if (command === OPS.paintFormXObjectBegin) {
      saved.push(matrix)
      if (isMatrix(first)) matrix = multiply(matrix, Array.from(first) as Matrix)
    } else if (command === OPS.paintFormXObjectEnd) matrix = saved.pop() ?? matrix
    else if (
      command === OPS.paintImageXObject ||
      command === OPS.paintInlineImageXObject ||
      command === OPS.paintImageXObjectRepeat
    ) {
      // An image fills the unit square; the matrix says how big that is on the page.
      const area = Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])
      if (pageArea > 0 && area / pageArea >= MIN_PICTURE_SHARE) pictures += 1
    } else if (command === OPS.constructPath && Array.isArray(given)) {
      const box: unknown = given[2]
      if (!Array.isArray(box) && !ArrayBuffer.isView(box)) continue
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = Array.from(box as ArrayLike<number>)
      const scaleX = Math.hypot(matrix[0], matrix[1])
      const scaleY = Math.hypot(matrix[2], matrix[3])
      const width = Math.abs(x1 - x0) * scaleX
      const height = Math.abs(y1 - y0) * scaleY
      const bottom = Math.min(y0, y1) * scaleY + matrix[5]
      const left = Math.min(x0, x1) * scaleX + matrix[4]
      const top = bottom + height
      const right = left + width
      if (height <= MAX_RULE_THICKNESS && width >= MIN_RULE_LENGTH) {
        across.push({ at: bottom, from: left, to: right })
      } else if (width <= MAX_RULE_THICKNESS && height >= MIN_RULE_LENGTH) {
        down.push({ at: left, from: bottom, to: top })
      } else if (width >= MIN_RULE_LENGTH && height >= MIN_RULE_LENGTH / 2) {
        // A drawn box, e.g. one cell of a table: its four sides.
        across.push({ at: bottom, from: left, to: right }, { at: top, from: left, to: right })
        down.push({ at: left, from: bottom, to: top }, { at: right, from: bottom, to: top })
      }
    }
  }

  return {
    pictures,
    hasTable: formsTable(across, down),
  }
}

/** Returns a function that cuts single pages out of a PDF, each as a PDF of its own. */
export async function pageCutter(pdf: Buffer): Promise<(pageIndex: number) => Promise<Uint8Array>> {
  const source = await PDFDocument.load(pdf, { ignoreEncryption: true })
  return async (pageIndex) => {
    const single = await PDFDocument.create()
    const [page] = await single.copyPages(source, [pageIndex])
    if (page === undefined) throw new Error(`The PDF has no page ${pageIndex + 1}.`)
    single.addPage(page)
    return single.save()
  }
}
