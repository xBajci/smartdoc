import { upload } from '@vercel/blob/client'
import { useSyncExternalStore } from 'react'
import {
  addCategoryFn,
  createDocumentFn,
  getArchiveFn,
  getDocumentsFn,
  prepareUploadFn,
  removeCategoryFn,
  removeDocumentFn,
  reorderCategoriesFn,
  searchAdminDocumentsFn,
  signInFn,
  signOutFn,
  updateCategoryFn,
  updateDocumentFn,
} from '~/server/archive-functions'
import { getExtractedTextFn, processDocumentFn } from '~/server/processing-functions'
import type {
  ArchiveDocument,
  ArchiveSnapshot,
  CategoryInput,
  DocumentChanges,
  DocumentQuery,
} from './types'
import type { UploadProblem } from './upload'

/**
 * The browser's copy of what every screen needs. Screens read it through
 * `useArchive()`; every change goes to the server first and the copy is then
 * read again. Documents are not here: a screen asks the server for the page
 * it shows, and asks again whenever `revision` changes.
 */
let state: ArchiveSnapshot = {
  categories: [],
  isAdmin: false,
  storageMode: 'local',
  revision: 0,
}
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getState() {
  return state
}

export function useArchive(): ArchiveSnapshot {
  return useSyncExternalStore(subscribe, getState, getState)
}

/** Route loaders call this, so a screen never renders before the archive is known. */
export async function loadArchive() {
  state = { ...(await getArchiveFn()), revision: state.revision + 1 }
  for (const listener of listeners) listener()
}

async function changed<T>(operation: Promise<T>): Promise<T> {
  const result = await operation
  await loadArchive()
  return result
}

export interface UploadInput {
  file: File
  sha256: string
  categoryId: string
  customDescription: string
}

export type UploadResult =
  | { ok: true; id: string }
  | { ok: false; problem: UploadProblem | 'duplicate' | 'failed'; duplicateId?: string }

/**
 * One file, start to finish: ask the server, hand the bytes to storage, then
 * have the server record the document. Each file stands alone, so a failure
 * here never touches the rest of a batch.
 */
/** Sends a file to this application and reports how much of it has gone; resolves with the HTTP status. */
function putFile(url: string, file: File, onProgress: (fraction: number) => void) {
  return new Promise<number>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    })
    request.addEventListener('load', () => resolve(request.status))
    request.addEventListener('error', () => reject(new Error('Upload failed.')))
    request.addEventListener('abort', () => reject(new Error('Upload was aborted.')))
    request.send(file)
  })
}

async function uploadDocument(
  input: UploadInput,
  onProgress: (fraction: number) => void,
): Promise<UploadResult> {
  const prepared = await prepareUploadFn({ data: { sha256: input.sha256 } })
  if (prepared.duplicateId !== null) {
    return { ok: false, problem: 'duplicate', duplicateId: prepared.duplicateId }
  }

  let blobUrl: string | null = null
  if (state.storageMode === 'blob') {
    const blob = await upload(`documents/${prepared.id}/${input.file.name}`, input.file, {
      access: 'private',
      handleUploadUrl: '/api/upload-blob',
      multipart: input.file.size > 8 * 1024 * 1024,
      onUploadProgress: (event) => onProgress(event.percentage / 100),
    })
    blobUrl = blob.url
  } else {
    const status = await putFile(`/api/upload/${prepared.id}`, input.file, onProgress)
    if (status === 413) return { ok: false, problem: 'too-large' }
    if (status < 200 || status >= 300) return { ok: false, problem: 'failed' }
  }

  const created = await createDocumentFn({
    data: {
      id: prepared.id,
      blobUrl,
      originalFilename: input.file.name,
      categoryId: input.categoryId,
      customDescription: input.customDescription,
      sha256: input.sha256,
    },
  })
  if (created.ok) return { ok: true, id: prepared.id }
  if (created.problem === 'duplicate') {
    return { ok: false, problem: 'duplicate', duplicateId: created.duplicateId }
  }
  return { ok: false, problem: created.problem === 'missing' ? 'failed' : created.problem }
}

/** Documents waiting for `processInBackground`, and how many are being read right now. */
const waiting: string[] = []
let reading = 0
const READ_AT_ONCE = 2

function pump() {
  while (reading < READ_AT_ONCE) {
    const id = waiting.shift()
    if (id === undefined) return
    reading += 1
    void archive
      .processDocument(id)
      .catch(() => undefined)
      .finally(() => {
        reading -= 1
        pump()
      })
  }
}

export const archive = {
  signIn: (password: string) => changed(signInFn({ data: { password } })),
  signOut: () => changed(signOutFn()),

  /** One page of all documents for the administration; `null` when not signed in. */
  adminDocuments: (query: DocumentQuery) => searchAdminDocumentsFn({ data: query }),

  /** Documents by id; the ones the reader may not see are left out. */
  documentsById: (ids: readonly string[]): Promise<ArchiveDocument[]> =>
    ids.length === 0 ? Promise.resolve([]) : getDocumentsFn({ data: { ids: [...ids] } }),

  /** The archive document with the same content as a chosen file, if there is one. */
  async duplicateOf(sha256: string): Promise<ArchiveDocument | null> {
    const { duplicateId } = await prepareUploadFn({ data: { sha256 } })
    if (duplicateId === null) return null
    const [duplicate] = await getDocumentsFn({ data: { ids: [duplicateId] } })
    return duplicate ?? null
  },

  async uploadDocument(
    input: UploadInput,
    onProgress: (fraction: number) => void = () => undefined,
  ): Promise<UploadResult> {
    try {
      return await changed(uploadDocument(input, onProgress))
    } catch {
      return { ok: false, problem: 'failed' }
    }
  },

  /** Resolves when processing has ended; the outcome is the document's new status. */
  async processDocument(id: string): Promise<void> {
    const running = processDocumentFn({ data: { id } })
    // The status changes as soon as the server takes the document, long before it is done.
    setTimeout(() => void loadArchive().catch(() => undefined), 400)
    await changed(running)
  },
  /**
   * Has the server read the content of these documents, a few at a time. It
   * runs on its own: screens only watch the status of each document change.
   */
  processInBackground(ids: readonly string[]) {
    waiting.push(...ids)
    pump()
  },
  extractedText: (id: string) => getExtractedTextFn({ data: { id } }),

  updateDocument: (id: string, changes: DocumentChanges) =>
    changed(updateDocumentFn({ data: { id, changes } })),
  removeDocument: (id: string) => changed(removeDocumentFn({ data: { id } })),

  /** Resolves with the id of the new category. */
  addCategory: (category: CategoryInput) => changed(addCategoryFn({ data: category })),
  updateCategory: (id: string, category: CategoryInput) =>
    changed(updateCategoryFn({ data: { id, category } })),
  /** The ids of all categories but the fallback one, in the new order. */
  reorderCategories: (ids: readonly string[]) =>
    changed(reorderCategoriesFn({ data: { ids: [...ids] } })),
  removeCategory: (id: string) => changed(removeCategoryFn({ data: { id } })),
}
