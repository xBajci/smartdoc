export type DocumentFormat = 'pdf' | 'image'

/** `uploading` exists only in the administrator's browser; the rest are the database states. */
export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed'

/** A document is published, so a visitor sees it, once its processing ended well. */
export function isPublished(document: { status: DocumentStatus }): boolean {
  return document.status === 'ready'
}

export interface Category {
  id: string
  name: string
  /** What belongs here; helps the decision model pick the category. Empty for a visitor. */
  description: string
  /** Colour of the index tab that marks the category in every view. */
  color: string
  /** The fallback category receives documents of a removed category and cannot be removed. */
  isFallback: boolean
  /** How many documents the reader may see in the category: all for the administrator, public ones otherwise. */
  documentCount: number
}

/** What the administrator writes about a category; the same for a new one and for a change. */
export interface CategoryInput {
  name: string
  description: string
  /** One of `CATEGORY_COLORS`, or the colour the category already has. */
  color: string
}

export interface ArchiveDocument {
  id: string
  originalFilename: string
  title: string
  /** Where the name came from: the file name, processing, or the administrator. */
  titleSource: 'filename' | 'auto' | 'manual'
  format: DocumentFormat
  mimeType: string
  sizeBytes: number
  /** Address of the original inside this application. */
  fileUrl: string
  /** Address of the small copy of an image; `null` for a PDF or when none exists. */
  thumbnailUrl: string | null
  /** Content fingerprint used to recognise a duplicate upload. */
  sha256: string
  categoryId: string
  /** ISO date of insertion into the archive — not the date the document was issued. */
  addedAt: string
  issuedYear: number | null
  /** The day the document is dated, `YYYY-MM-DD`; `null` when only the year, or nothing, is known. */
  issuedOn: string | null
  /** Who supplied `issuedYear` and `issuedOn`; a manual value is never overwritten by processing. */
  issuedYearSource: 'auto' | 'manual' | null
  customDescription: string
  /** One or two sentences written by processing. */
  shortDescription: string
  status: DocumentStatus
  /** `null` until processing has looked for text in the document. */
  hasText: boolean | null
  errorReason: string | null
  pageCount: number | null
  /** What reading this document with AI has cost so far. Only the administrator receives it. */
  usage: DocumentUsage | null
}

export interface DocumentUsage {
  /** Every model that worked on the document, as provider:model. */
  models: string[]
  /** Sum over all processing runs, in US dollars; `null` when no call had a known price. */
  costUsd: number | null
}

export type ViewMode = 'seznam' | 'nahled'

/**
 * Best match, newest, oldest, by name, by category; `-z` is the same column
 * the other way round. Best match needs searched words and is the order a search starts with.
 */
export type SortOrder =
  | 'shoda'
  /** By the date of the document itself, newest first; `vydane-z` is oldest first. */
  | 'vydane'
  | 'vydane-z'
  /** By the day the document was added to the archive. */
  | 'nove'
  | 'stare'
  | 'nazev'
  | 'nazev-z'
  | 'kategorie'
  | 'kategorie-z'

export type YearFilter = number | 'neznamy'

/** Kind of file a list is narrowed to. */
export type FileKindFilter = 'pdf' | 'obrazek'

export interface LibrarySearch {
  q?: string
  kategorie?: string
  rok?: YearFilter
  typ?: FileKindFilter
  zobrazeni?: ViewMode
  razeni?: SortOrder
  /** How many documents the list shows; "Zobrazit další" raises it. */
  pocet?: number
  doc?: string
  /** Page inside the open PDF. */
  strana?: number
}

/** What the server is asked for: one page of the documents that match. */
export interface DocumentQuery {
  q?: string
  kategorie?: string
  rok?: YearFilter
  typ?: FileKindFilter
  razeni?: SortOrder
  stranka?: number
  pocet?: number
  /** Only the administrator may ask for a status other than `ready`. */
  stav?: DocumentStatus
}

/** A document in a list, with the place in its content that matched the search. */
export interface FoundDocument extends ArchiveDocument {
  /** A few words of the content around the searched words; `null` when the content did not match. */
  snippet: string | null
}

export interface DocumentPage {
  documents: FoundDocument[]
  /** How many documents match, over all pages. */
  total: number
  /** The page that was returned; a request past the end gets the last page. */
  page: number
  pageCount: number
  /** Rows a full page holds. */
  pageSize: number
  /** Documents of each category that match the search and the other filters, by category id. */
  categoryCounts: Record<string, number>
  /** Years that at least one document the reader may see carries, newest first. */
  years: number[]
  /** How many documents the reader may see when nothing is searched or filtered. */
  archiveTotal: number
  /** Documents whose processing failed. Counted only for the administrator. */
  failedCount: number
}

/** The description shown to visitors: the administrator's own text wins over the automatic short one. */
export function shownDescription(document: ArchiveDocument): string {
  return document.customDescription.trim() === ''
    ? document.shortDescription
    : document.customDescription
}

export interface ArchiveSnapshot {
  categories: Category[]
  /** Whether this browser holds an administrator session. */
  isAdmin: boolean
  /** How the browser hands a file over: straight to blob storage, or to this application. */
  storageMode: 'blob' | 'local'
  /** Grows by one each time the archive is read again; lists of documents reload on it. */
  revision: number
}

export interface DocumentChanges {
  title: string
  categoryId: string
  customDescription: string
  issuedYear: number | null
  /** `YYYY-MM-DD`; its year then replaces `issuedYear`. */
  issuedOn: string | null
}
