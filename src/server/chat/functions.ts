import { createServerFn } from '@tanstack/react-start'
import { CHAT_FEEDBACK_FILTERS, MAX_CHAT_DOCUMENTS } from '~/chat/types'
import type {
  ChatConversationSummary,
  ChatFeedbackFilter,
  ChatQuestion,
  ChatScope,
  ChatTrace,
  ChatTraceSummary,
  ChatUpdate,
} from '~/chat/types'
import { matching, text, UUID } from '../input'
import { adminOrNull, clientKey, forAdmin, isAdmin } from '../session'
import {
  findChatConversation,
  findChatTrace,
  listChatConversations,
  rateChatAnswer,
} from './chat-service'
import { askArchiveLive } from './question'
import { MAX_QUESTION_CHARACTERS } from './settings'

/** What the browser calls on the server for the chat and its debugger. */

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
    // Only a random UUID can be a conversation's key; anything else starts a new conversation, without an error.
    conversationId:
      typeof data.conversationId === 'string' && UUID.test(data.conversationId)
        ? data.conversationId
        : undefined,
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

/** Recent chat conversations for the debugger, all or by their feedback. `null` for a visitor. */
export const getChatConversationsFn = createServerFn({ method: 'GET' })
  .validator((data: { filter?: ChatFeedbackFilter } | undefined) => ({
    // A filter nobody knows lists everything.
    filter: CHAT_FEEDBACK_FILTERS.find((known) => known === data?.filter) ?? 'all',
  }))
  .handler(
    adminOrNull(({ data }): Promise<ChatConversationSummary[]> =>
      listChatConversations(data.filter),
    ),
  )

/** The questions of one conversation, oldest first. */
export const getChatConversationFn = createServerFn({ method: 'GET' })
  .validator((data: { conversationId: string }) => ({
    conversationId: text(data.conversationId, 200),
  }))
  .handler(
    forAdmin(({ data }): Promise<ChatTraceSummary[]> => findChatConversation(data.conversationId)),
  )

export const getChatTraceFn = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => ({ id: matching(data.id, UUID) }))
  .handler(forAdmin(({ data }): Promise<ChatTrace | null> => findChatTrace(data.id)))
