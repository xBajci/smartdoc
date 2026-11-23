import { createServerFn } from '@tanstack/react-start'
import { calendarDay, libraryOrder, normalizeLibrarySearch, positiveInteger } from '~/archive/query'
import { CHAT_FEEDBACK_FILTERS, MAX_CHAT_DOCUMENTS } from '~/archive/types'
import type {
  ArchiveDocument,
  ArchiveSnapshot,
  ChatFeedbackFilter,
  ChatQuestion,
  ChatScope,
  ChatSessionSummary,
  ChatTrace,
  ChatTraceSummary,
  ChatUpdate,
  CategoryInput,
  DocumentChanges,
  DocumentPage,
  DocumentQuery,
  DocumentStatus,
  SkillInput,
  SkillsReport,
  UsageReport,
} from '~/archive/types'
import * as service from './archive-service'
import {
  askArchiveLive,
  findChatSession,
  findChatTrace,
  listChatSessions,
  rateChatAnswer,
} from './chat/chat-service'
import { MAX_QUESTION_CHARACTERS } from './chat/settings'
import { storageMode } from './config'
import { documentDebug } from './debug-service'
import { processDocument } from './processing'
import { searchDocuments } from './search-service'
import { clientKey, isAdmin, requireAdmin, signIn, signOut, type SignInResult } from './session'
import {
  createSkill,
  deleteSkill,
  MAX_SKILL_CHARACTERS,
  resetSkill,
  saveSkill,
  skillsReport,
  updateSkill,
} from './skills-service'
import { localOriginalKey } from './storage'
import { usageReport } from './usage-service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SHA256 = /^[0-9a-f]{64}$/
const HEX_COLOR = /^#[0-9a-f]{6}$/

function text(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error('Invalid input.')
  return value
}

function matching(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('Invalid input.')
  return value
}

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

/** One page of the public documents that match a search. */
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
  .handler(async ({ data }): Promise<DocumentPage | null> =>
    isAdmin() ? searchDocuments(data, true) : null,
  )

/** Documents by id. A visitor gets only the public ones among them. */
export const getDocumentsFn = createServerFn({ method: 'GET' })
  .validator((data: { ids: string[] }) => {
    if (!Array.isArray(data.ids) || data.ids.length > 50) throw new Error('Invalid input.')
    return { ids: data.ids.map((id) => text(id, 200)) }
  })
  .handler(({ data }): Promise<ArchiveDocument[]> => service.findDocuments(data.ids, isAdmin()))

function chatQuestion(data: ChatQuestion): ChatQuestion {
  const question = text(data.question, MAX_QUESTION_CHARACTERS).trim()
  if (question === '') throw new Error('Invalid input.')
  const documentIds =
    data.scope === 'documents' && Array.isArray(data.documentIds)
      ? [...new Set(data.documentIds.map((id) => text(id, 200)))].slice(0, MAX_CHAT_DOCUMENTS)
      : []
  // No chosen document means the whole archive, never an empty search.
  const scope: ChatScope = documentIds.length === 0 ? 'archive' : 'documents'
  return {
    question,
    // Only a random UUID can be a session's key; anything else starts a new session, without an error.
    sessionId:
      typeof data.sessionId === 'string' && UUID.test(data.sessionId) ? data.sessionId : undefined,
    scope,
    documentIds,
  }
}

/**
 * One question to the chat. Open to visitors, so it is limited per visitor and
 * per day. It streams what the chat is doing and ends with the answer.
 */
export const askArchiveFn = createServerFn({ method: 'POST' })
  .validator(chatQuestion)
  .handler(({ data }): AsyncGenerator<ChatUpdate> =>
    askArchiveLive(data, { admin: isAdmin(), hash: clientKey() }),
  )

/**
 * What a visitor says of one answer: whether they found in it what they were
 * looking for. Open to visitors; the id of the answer's trace is the right to
 * say it, and only the one who asked was given that id.
 */
export const rateChatFn = createServerFn({ method: 'POST' })
  .validator((data: { traceId: string; helpful: boolean }) => {
    if (typeof data.helpful !== 'boolean') throw new Error('Invalid input.')
    return { traceId: matching(data.traceId, UUID), helpful: data.helpful }
  })
  .handler(async ({ data }): Promise<{ ok: boolean }> => ({
    ok: await rateChatAnswer(data.traceId, data.helpful),
  }))

/** Recent chat sessions for the debugger, all or by their feedback. `null` for a visitor. */
export const getChatSessionsFn = createServerFn({ method: 'GET' })
  .validator((data: { filter?: ChatFeedbackFilter } | undefined) => ({
    // A filter nobody knows lists everything.
    filter: CHAT_FEEDBACK_FILTERS.find((known) => known === data?.filter) ?? 'all',
  }))
  .handler(async ({ data }): Promise<ChatSessionSummary[] | null> =>
    isAdmin() ? listChatSessions(data.filter) : null,
  )

/** The questions of one session, oldest first. */
export const getChatSessionFn = createServerFn({ method: 'GET' })
  .validator((data: { sessionId: string }) => ({ sessionId: text(data.sessionId, 200) }))
  .handler(async ({ data }): Promise<ChatTraceSummary[]> => {
    requireAdmin()
    return findChatSession(data.sessionId)
  })

export const getChatTraceFn = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => ({ id: matching(data.id, UUID) }))
  .handler(async ({ data }): Promise<ChatTrace | null> => {
    requireAdmin()
    return findChatTrace(data.id)
  })

export const signInFn = createServerFn({ method: 'POST' })
  .validator((data: { password: string }) => ({ password: text(data.password, 1000) }))
  .handler(({ data }): Promise<SignInResult> => signIn(data.password))

export const signOutFn = createServerFn({ method: 'POST' }).handler(() => {
  signOut()
})

/** Before any byte is sent: is this content already in the archive, and under which id will it be stored? */
export const prepareUploadFn = createServerFn({ method: 'POST' })
  .validator((data: { sha256: string }) => ({ sha256: matching(data.sha256, SHA256) }))
  .handler(async ({ data }) => {
    requireAdmin()
    return {
      duplicateId: await service.findDocumentIdBySha(data.sha256),
      id: service.newDocumentId(),
    }
  })

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
  .handler(async ({ data }) => {
    requireAdmin()
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
  })

/**
 * Reads the content of a stored document. The answer comes when processing
 * has ended, well or badly; the outcome is in the document's status.
 */
export const processDocumentFn = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => ({ id: text(data.id, 200) }))
  .handler(async ({ data }) => {
    requireAdmin()
    await processDocument(data.id)
  })

export const getExtractedTextFn = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => ({ id: text(data.id, 200) }))
  .handler(async ({ data }) => {
    requireAdmin()
    return service.findExtractedText(data.id)
  })

/** What processing has cost. `null` for a visitor, so the page can show the sign-in form instead. */
export const getUsageFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<UsageReport | null> => (isAdmin() ? usageReport() : null),
)

/** The processing of one document, step by step, for the debug panel. */
export const getDocumentDebugFn = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => ({ id: text(data.id, 200) }))
  .handler(async ({ data }) => {
    requireAdmin()
    return documentDebug(data.id)
  })

export const getSkillsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SkillsReport | null> => (isAdmin() ? skillsReport() : null),
)

/** A list of short texts, e.g. the places of a skill. */
function texts(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error('Invalid input.')
  return value.map((item) => text(item, 200))
}

function skillGroup(value: unknown): 'zpracovani' | 'chat' {
  if (value !== 'zpracovani' && value !== 'chat') throw new Error('Invalid input.')
  return value
}

/** The text the administrator wrote for a skill; it is in use from the next call on. */
export const saveSkillFn = createServerFn({ method: 'POST' })
  .validator((data: { key: string; content: string }) => ({
    key: text(data.key, 200),
    content: text(data.content, MAX_SKILL_CHARACTERS),
  }))
  .handler(async ({ data }) => {
    requireAdmin()
    return saveSkill(data.key, data.content)
  })

/** A skill of the administrator's own. Returns its key, or `null` when the input is not complete. */
export const createSkillFn = createServerFn({ method: 'POST' })
  .validator((data: SkillInput) => ({
    title: text(data.title, 200),
    group: skillGroup(data.group),
    uses: texts(data.uses, 20),
    content: text(data.content, MAX_SKILL_CHARACTERS),
  }))
  .handler(async ({ data }) => {
    requireAdmin()
    return createSkill(data)
  })

export const updateSkillFn = createServerFn({ method: 'POST' })
  .validator((data: { key: string; title: string; uses: string[]; enabled: boolean }) => ({
    key: text(data.key, 200),
    title: text(data.title, 200),
    uses: texts(data.uses, 20),
    enabled: data.enabled === true,
  }))
  .handler(async ({ data }) => {
    requireAdmin()
    return updateSkill(data.key, data)
  })

export const deleteSkillFn = createServerFn({ method: 'POST' })
  .validator((data: { key: string }) => ({ key: text(data.key, 200) }))
  .handler(async ({ data }) => {
    requireAdmin()
    await deleteSkill(data.key)
  })

export const resetSkillFn = createServerFn({ method: 'POST' })
  .validator((data: { key: string }) => ({ key: text(data.key, 200) }))
  .handler(async ({ data }) => {
    requireAdmin()
    await resetSkill(data.key)
  })

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
  .handler(async ({ data }) => {
    requireAdmin()
    await service.updateDocument(data.id, data.changes)
  })

export const removeDocumentFn = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => ({ id: text(data.id, 200) }))
  .handler(async ({ data }) => {
    requireAdmin()
    await service.removeDocument(data.id)
  })

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
  .handler(async ({ data }) => {
    requireAdmin()
    return service.addCategory(data)
  })

export const updateCategoryFn = createServerFn({ method: 'POST' })
  .validator((data: { id: string; category: CategoryInput }) => ({
    id: text(data.id, 200),
    category: categoryInput(data.category),
  }))
  .handler(async ({ data }) => {
    requireAdmin()
    await service.updateCategory(data.id, data.category)
  })

export const reorderCategoriesFn = createServerFn({ method: 'POST' })
  .validator((data: { ids: string[] }) => {
    if (!Array.isArray(data.ids) || data.ids.length > 200) throw new Error('Invalid input.')
    return { ids: data.ids.map((id) => text(id, 200)) }
  })
  .handler(async ({ data }) => {
    requireAdmin()
    await service.reorderCategories(data.ids)
  })

export const removeCategoryFn = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => ({ id: text(data.id, 200) }))
  .handler(async ({ data }) => {
    requireAdmin()
    await service.removeCategory(data.id)
  })
