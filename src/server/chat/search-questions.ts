/** A document the search must find for a question, as written in `docs/tests/search-questions.md`. */
export interface ExpectedDocument {
  /** The title of the document, or its beginning. */
  title: string
  /** The pages, as written: "2" or "2–3". */
  pages: string
}

export interface SearchQuestion {
  number: number
  name: string
  question: string
  /** The answer, checked in the text of the documents. */
  answer: string
  /** Why the question is hard: what the search or the chat can mistake. */
  trap: string
  /** Empty when the archive holds no answer. */
  documents: ExpectedDocument[]
}

const SECTION = /^### (\d+)\. (.+)$/gm
const FIELD = /^- \*\*(.+?):\*\*/gm
const NO_DOCUMENTS = 'žádné'

/** The text of each `- **Name:**` field of a section, with wrapped lines joined. */
function fieldsOf(section: string): Map<string, string> {
  const fields = new Map<string, string>()
  const starts = [...section.matchAll(FIELD)]
  starts.forEach((match, index) => {
    const end = starts[index + 1]?.index ?? section.length
    const name = match[1] ?? ''
    fields.set(name, section.slice((match.index ?? 0) + match[0].length, end).trim())
  })
  return fields
}

/** A field as one line: the Markdown wraps long text. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function documentOf(item: string, number: number): ExpectedDocument {
  const text = oneLine(item)
  const found = /^(.*), s\. ([\d–-]+)$/.exec(text)
  if (found === null) throw new Error(`Question ${number}: no ", s. <page>" in "${text}".`)
  return { title: found[1] ?? '', pages: found[2] ?? '' }
}

function documentsOf(field: string, number: number): ExpectedDocument[] {
  if (field === NO_DOCUMENTS) return []
  // A field with several documents lists them one per line, each starting with "- ".
  const items = field.startsWith('- ')
    ? field.split(/^\s*- /m).filter((item) => item.trim() !== '')
    : [field]
  return items.map((item) => documentOf(item, number))
}

/** Reads the questions from the Markdown file; a question it cannot read stops it. */
export function parseSearchQuestions(markdown: string): SearchQuestion[] {
  const sections = [...markdown.matchAll(SECTION)]
  return sections.map((match, index) => {
    const number = Number(match[1])
    const end = sections[index + 1]?.index ?? markdown.length
    const fields = fieldsOf(markdown.slice(match.index ?? 0, end))
    const question = fields.get('Otázka')
    const answer = fields.get('Odpověď')
    const trap = fields.get('Past')
    const documents = fields.get('Správné dokumenty')
    if (
      question === undefined ||
      answer === undefined ||
      trap === undefined ||
      documents === undefined
    ) {
      throw new Error(
        `Question ${number}: "Otázka", "Odpověď", "Past" or "Správné dokumenty" is missing.`,
      )
    }
    return {
      number,
      name: match[2] ?? '',
      question,
      answer: oneLine(answer),
      trap: oneLine(trap),
      documents: documentsOf(documents, number),
    }
  })
}

/**
 * For every expected document, the place of its first piece in a ranked list
 * of pieces, from one; `null` when none of its pieces is in the list.
 */
export function ranksOfDocuments(
  pieces: readonly { documentId: string }[],
  documentIds: readonly string[],
): (number | null)[] {
  return documentIds.map((id) => {
    const index = pieces.findIndex((piece) => piece.documentId === id)
    return index === -1 ? null : index + 1
  })
}
