import type { ChatProgress, ChatSource } from '~/archive/types'

export type { ChatProgress, ChatScope, ChatSource } from '~/archive/types'

export interface ChatMessage {
  id: string
  role: 'visitor' | 'archive'
  /** Marks like [1] in the text point at `sources`, counted from one. */
  text: string
  sources?: ChatSource[]
  /** The answer is still being made. */
  pending?: boolean
  /**
   * What the chat has started doing for a pending answer, oldest first.
   * `almost` is the panel's own: the answer is taking a while to write.
   */
  progress?: (ChatProgress | 'almost')[]
  /** The message says why there is no answer; it is not part of the conversation. */
  failed?: boolean
  /** The record of an answer on the server; what the visitor says of the answer is stored under it. */
  traceId?: string
  /** Whether the visitor found in the answer what they were looking for; `undefined` until they say. */
  helpful?: boolean
  /** Where the last word of the visitor about the answer is on its way to the server. */
  rating?: 'storing' | 'thanked' | 'failed'
}
