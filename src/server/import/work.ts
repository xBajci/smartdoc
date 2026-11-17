/** What `import:prepare` writes about one file, for the reader and for `import:load`. */
export interface PreparedDocument {
  /** Order of the file in the import, e.g. "017"; names its files in the work folder. */
  id: string
  /** Where the original lies on this computer. */
  source: string
  /** Path inside the imported folder; its first folder is a hint for the category. */
  relative: string
  filename: string
  format: 'pdf' | 'image'
  mimeType: string
  sha256: string
  /** Empty for an image. */
  pages: PreparedPage[]
  /** Pages a reader must look at, in the order they lie in `<id>.vision.pdf`. */
  visionPages: number[]
}

export interface PreparedPage {
  page: number
  /** `plain`: text only. `mixed`: text with a table or a picture. `scanned`: no text layer. */
  kind: 'plain' | 'mixed' | 'scanned'
  /** The text layer. */
  text: string
  pictures: number
  hasTable: boolean
}

/** What the reader writes back about one file, as `<id>.result.json`. */
export interface ReadDocument {
  title: string
  shortDescription: string
  issuedYear: number | null
  /** The day the document is dated, `YYYY-MM-DD`, when the content gives the whole date. */
  issuedOn?: string | null
  /** Id of a category of the archive. */
  category: string
  /** Image only: a paragraph about what it shows. */
  description?: string
  /**
   * By page number, one entry for every page in `visionPages`. For a mixed
   * page: what the text layer lacks (tables in Markdown, a line for each
   * picture); may be empty. For a scanned page: all of its text.
   */
  pages?: Record<string, string>
}
