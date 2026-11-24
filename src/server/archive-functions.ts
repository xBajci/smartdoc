import { createServerFn } from '@tanstack/react-start'
import { calendarDay, libraryOrder, normalizeLibrarySearch, positiveInteger } from '~/archive/query'
import type {
  ArchiveDocument,
  ArchiveSnapshot,
  CategoryInput,
  DocumentChanges,
  DocumentPage,
  DocumentQuery,
  DocumentStatus,
} from '~/archive/types'
import * as service from './archive-service'
import { storageMode } from './config'
import { HEX_COLOR, matching, SHA256, text, UUID } from './input'
import { searchDocuments } from './search-service'
import { adminOrNull, forAdmin, isAdmin, signIn, signOut, type SignInResult } from './session'
import { localOriginalKey } from './storage'

/**
 * What the browser calls on the server for the archive: its documents and
 * categories, uploads, and signing in. The chat, processing and the skills
 * have function files of their own.
 */

const STATUSES: readonly DocumentStatus[] = ['queued', 'processing', 'ready', 'failed']

/** What every screen needs: the categories and who is looking. Documents come page by page. */
export const getArchiveFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Omit<ArchiveSnapshot, 'revision'>> => {
    const admin = isAdmin()
    return {
      categories: await service.listCategories(admin),
      isAdmin: admin,
      storageMode: storageMode(),
    }
  },
)

function documentQuery(data: DocumentQuery): DocumentQuery {
  const { q, kategorie, rok, typ, razeni, pocet } = normalizeLibrarySearch({ ...data })
  return {
    q: q?.slice(0, 200),
    kategorie: kategorie?.slice(0, 200),
    rok,
    typ,
    razeni,
    stranka: positiveInteger(data.stranka),
    pocet,
    stav: STATUSES.find((status) => status === data.stav),
  }
}

/** One page of the published documents that match a search. */
export const searchLibraryFn = createServerFn({ method: 'GET' })
  .validator(documentQuery)
  .handler(({ data }): Promise<DocumentPage> =>
    // The library reads by the date of the documents; the administration by the day they were added.
    searchDocuments(
      { ...data, razeni: data.razeni ?? libraryOrder(data.q), stav: undefined },
      false,
    ),
  )

/** One page of all documents, in any state. `null` for a visitor. */
export const searchAdminDocumentsFn = createServerFn({ method: 'GET' })
  .validator(documentQuery)
  .handler(adminOrNull(({ data }): Promise<DocumentPage> => searchDocuments(data, true)))

/** Documents by id. A visitor gets only the published ones among them. */
export const getDocumentsFn = createServerFn({ method: 'GET' })
  .validator((data: { ids: string[] }) => {
    if (!Array.isArray(data.ids) || data.ids.length > 50) throw new Error('Invalid input.')
    return { ids: data.ids.map((id) => text(id, 200)) }
  })
  .handler(({ data }): Promise<ArchiveDocument[]> => service.findDocuments(data.ids, isAdmin()))

export const signInFn = createServerFn({ method: 'POST' })
  .validator((data: { password: string }) => ({ password: text(data.password, 1000) }))
  .handler(({ data }): Promise<SignInResult> => signIn(data.password))

export const signOutFn = createServerFn({ method: 'POST' }).handler(() => {
  signOut()
})

/** Before any byte is sent: is this content already in the archive, and under which id will it be stored? */
export const prepareUploadFn = createServerFn({ method: 'POST' })
  .validator((data: { sha256: string }) => ({ sha256: matching(data.sha256, SHA256) }))
  .handler(
    forAdmin(async ({ data }) => ({
      duplicateId: await service.findDocumentIdBySha(data.sha256),
      id: service.newDocumentId(),
    })),
  )

interface CreateDocumentInput {
  id: string
  /** Address returned by blob storage; ignored for a local upload, whose place follows from the id. */
  blobUrl: string | null
  originalFilename: string
  categoryId: string
  customDescription: string
  sha256: string
}

export const createDocumentFn = createServerFn({ method: 'POST' })
  .validator((data: CreateDocumentInput) => ({
    id: matching(data.id, UUID),
    blobUrl: data.blobUrl === null ? null : text(data.blobUrl, 2000),
    originalFilename: text(data.originalFilename, 255),
    categoryId: text(data.categoryId, 200),
    customDescription: text(data.customDescription, 5000),
    sha256: matching(data.sha256, SHA256),
  }))
  .handler(
    forAdmin(({ data }) => {
      let storageKey = localOriginalKey(data.id)
      if (storageMode() === 'blob') {
        // The address must be the one this very upload was allowed to write to.
        if (
          data.blobUrl === null ||
          !new URL(data.blobUrl).pathname.startsWith(`/documents/${data.id}/`)
        ) {
          throw new Error('Invalid input.')
        }
        storageKey = data.blobUrl
      }
      return service.createDocument({ ...data, storageKey })
    }),
  )

export const updateDocumentFn = createServerFn({ method: 'POST' })
  .validator((data: { id: string; changes: DocumentChanges }) => {
    const year = data.changes.issuedYear
    if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 9999)) {
      throw new Error('Invalid input.')
    }
    return {
      id: text(data.id, 200),
      changes: {
        title: text(data.changes.title, 300),
        categoryId: text(data.changes.categoryId, 200),
        customDescription: text(data.changes.customDescription, 5000),
        issuedYear: year,
        issuedOn: data.changes.issuedOn === null ? null : calendarDay(data.changes.issuedOn),
      },
    }
  })
  .handler(
    forAdmin(async ({ data }) => {
      await service.updateDocument(data.id, data.changes)
    }),
  )

export const removeDocumentFn = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => ({ id: text(data.id, 200) }))
  .handler(
    forAdmin(async ({ data }) => {
      await service.removeDocument(data.id)
    }),
  )

/** The longest hint a category may carry for the decision model. */
const MAX_CATEGORY_DESCRIPTION = 1000

function categoryInput(data: CategoryInput): CategoryInput {
  return {
    name: text(data.name, 100),
    description: text(data.description, MAX_CATEGORY_DESCRIPTION),
    color: matching(data.color, HEX_COLOR),
  }
}

/** Returns the id of the new category. */
export const addCategoryFn = createServerFn({ method: 'POST' })
  .validator(categoryInput)
  .handler(forAdmin(({ data }) => service.addCategory(data)))

export const updateCategoryFn = createServerFn({ method: 'POST' })
  .validator((data: { id: string; category: CategoryInput }) => ({
    id: text(data.id, 200),
    category: categoryInput(data.category),
  }))
  .handler(
    forAdmin(async ({ data }) => {
      await service.updateCategory(data.id, data.category)
    }),
  )

export const reorderCategoriesFn = createServerFn({ method: 'POST' })
  .validator((data: { ids: string[] }) => {
    if (!Array.isArray(data.ids) || data.ids.length > 200) throw new Error('Invalid input.')
    return { ids: data.ids.map((id) => text(id, 200)) }
  })
  .handler(
    forAdmin(async ({ data }) => {
      await service.reorderCategories(data.ids)
    }),
  )

export const removeCategoryFn = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => ({ id: text(data.id, 200) }))
  .handler(
    forAdmin(async ({ data }) => {
      await service.removeCategory(data.id)
    }),
  )
