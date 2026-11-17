import type { ChatSource } from '~/archive/types'

export type { ChatScope, ChatSource } from '~/archive/types'

export interface ChatMessage {
  id: string
  role: 'visitor' | 'archive'
  /** Marks like [1] in the text point at `sources`, counted from one. */
  text: string
  sources?: ChatSource[]
  /** The answer is still being made. */
  pending?: boolean
  /** The message says why there is no answer; it is not part of the conversation. */
  failed?: boolean
}
