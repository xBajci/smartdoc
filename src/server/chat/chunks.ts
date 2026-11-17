/** A piece of a document before it is stored. */
export interface Chunk {
  /** Page of a PDF the piece is from; `null` for an image. */
  page: number | null
  text: string
}

/** One page of a document as processing read it. */
export interface PageText {
  page: number | null
  text: string
}

/** The best place to end a piece inside `text`: after a paragraph, a line, a sentence, or a word. */
function breakPoint(text: string, limit: number): number {
  const window = text.slice(0, limit)
  // A piece cut in its first half would be too short to say anything.
  const earliest = Math.floor(limit / 2)
  for (const mark of ['\n\n', '\n', '. ', '? ', '! ', ' ']) {
    const at = window.lastIndexOf(mark)
    if (at >= earliest) return at + mark.length
  }
  return limit
}

/**
 * Cuts a page into pieces of at most `size` characters. A piece ends where the
 * text pauses, and the next one starts `overlap` characters earlier, so a
 * sentence cut in two is whole in at least one of them.
 */
export function splitText(text: string, size: number, overlap: number): string[] {
  const clean = text.replace(/[ \t]+/g, ' ').trim()
  const pieces: string[] = []
  let start = 0
  while (clean.length - start > size) {
    const end = start + breakPoint(clean.slice(start), size)
    pieces.push(clean.slice(start, end).trim())
    // Step back to the start of a word, never past the piece just made.
    let next = Math.max(end - overlap, start + 1)
    const space = clean.indexOf(' ', next)
    if (overlap > 0 && space !== -1 && space < end) next = space + 1
    else if (overlap > 0) next = end
    start = next
  }
  const rest = clean.slice(start).trim()
  if (rest !== '') pieces.push(rest)
  return pieces
}

/** The pieces of a whole document, page by page. A page without text gives none. */
export function chunkPages(pages: readonly PageText[], size: number, overlap: number): Chunk[] {
  return pages.flatMap(({ page, text }) =>
    splitText(text, size, overlap).map((piece) => ({ page, text: piece })),
  )
}
