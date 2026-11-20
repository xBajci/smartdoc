import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { archive } from '~/archive/store'
import type { ArchiveDocument } from '~/archive/types'
import { FileBadge } from '~/components/FileBadge'
import { Icon } from '~/components/Icon'
import { cs, fill } from '~/copy/cs'
import { askArchiveFn, rateChatFn } from '~/server/archive'
import type { ChatMessage, ChatSource } from './types'

export type ChosenDocument = Pick<ArchiveDocument, 'id' | 'title'>

interface ChatPanelProps {
  /** The documents the visitor chose in the list to ask about, in the order chosen. */
  chosen: readonly ChosenDocument[]
  onUnchoose: (id: string) => void
  /** Takes every chosen document out, so the whole archive is searched again. */
  onUnchooseAll: () => void
  onOpenSource: (source: ChatSource) => void
  onClose: () => void
}

/** Turns the marks [1], [2] in an answer into visible references. */
function withReferences(text: string): ReactNode[] {
  return text.split(/(\[\d+\])/).map((part, index) =>
    /^\[\d+\]$/.test(part) ? (
      <span key={index} className="chat-reference">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

/**
 * The chat over the archive. The server keeps the conversation under a session
 * id; the panel only holds the id in memory and sends it with the next
 * question, so a closed page starts a new conversation.
 */
export function ChatPanel({
  chosen,
  onUnchoose,
  onUnchooseAll,
  onOpenSource,
  onClose,
}: Readonly<ChatPanelProps>) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [waiting, setWaiting] = useState(false)
  const [question, setQuestion] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)

  // Choosing a document in the list bounds the answer to the chosen ones and
  // waits for the question; with the last one gone the whole archive is back.
  const chosenBefore = useRef(0)
  useEffect(() => {
    if (chosen.length > chosenBefore.current) field.current?.focus()
    chosenBefore.current = chosen.length
  }, [chosen.length])
  const asked = useRef(0)
  /** From the last answer; `undefined` until the first one. */
  const sessionId = useRef<string | undefined>(undefined)

  // "Nový chat" forgets the conversation: the server gets no session id, so it
  // starts a new one. The chosen documents stay, they are a choice of the list.
  const [conversation, setConversation] = useState(0)
  function startAgain() {
    sessionId.current = undefined
    asked.current = 0
    setMessages([])
    setDocuments([])
    setQuestion('')
    setConversation((current) => current + 1)
  }
  // The button is gone with the conversation, so the new one waits in the field.
  useEffect(() => {
    if (conversation > 0) field.current?.focus()
  }, [conversation])

  // Sources name documents by id only; what to show of them is asked from the
  // server, which leaves out a document that is gone or not public.
  const [documents, setDocuments] = useState<readonly ArchiveDocument[]>([])
  const sourceIds = [
    ...new Set(
      messages.flatMap((message) => (message.sources ?? []).map((source) => source.documentId)),
    ),
  ].join(' ')
  useEffect(() => {
    if (sourceIds === '') return
    let current = true
    archive.documentsById(sourceIds.split(' ')).then(
      (found) => {
        if (current) setDocuments(found)
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [sourceIds])

  // Keeps the newest message in view, but leaves the first render alone.
  useEffect(() => {
    if (asked.current > 0) end.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  function ask(text: string) {
    const trimmed = text.trim()
    if (trimmed === '' || waiting) return
    asked.current += 1
    const answerId = `answer-${asked.current}`
    setMessages((current) => [
      ...current,
      { id: `question-${asked.current}`, role: 'visitor', text: trimmed },
      { id: answerId, role: 'archive', text: cs.chat.thinking, pending: true },
    ])
    setQuestion('')
    setWaiting(true)

    const settle = (answer: Partial<ChatMessage>) =>
      setMessages((current) =>
        current.map((message) =>
          message.id === answerId ? { ...message, pending: false, ...answer } : message,
        ),
      )
    askArchiveFn({
      data: {
        question: trimmed,
        sessionId: sessionId.current,
        scope: chosen.length === 0 ? 'archive' : 'documents',
        documentIds: chosen.map((document) => document.id),
      },
    })
      .then(
        (answer) => {
          if (answer.ok) sessionId.current = answer.sessionId
          settle(
            answer.ok
              ? { text: answer.text, sources: answer.sources, traceId: answer.traceId }
              : { text: cs.chat.problems[answer.problem], failed: true },
          )
        },
        () => settle({ text: cs.chat.problems.failed, failed: true }),
      )
      .finally(() => setWaiting(false))
  }

  // What the visitor says of one answer: whether they found in it what they
  // were looking for. Saying the other thing replaces the first.
  function rate(traceId: string, helpful: boolean) {
    const mark = (change: Partial<ChatMessage>) =>
      setMessages((current) =>
        // By the trace, not by the message: "Nový chat" counts the messages from one again.
        current.map((message) =>
          message.traceId === traceId ? { ...message, ...change } : message,
        ),
      )
    mark({ rating: 'storing' })
    rateChatFn({ data: { traceId, helpful } }).then(
      (result) => mark(result.ok ? { helpful, rating: 'thanked' } : { rating: 'failed' }),
      () => mark({ rating: 'failed' }),
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    ask(question)
  }

  const started = messages.length > 0
  const composer = (
    <form
      className={started ? 'chat-composer chat-composer--docked' : 'chat-composer'}
      onSubmit={submit}
    >
      <textarea
        ref={field}
        value={question}
        rows={started ? 1 : 3}
        onChange={(event) => setQuestion(event.target.value)}
        // Enter sends; Shift with Enter starts a new line.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            ask(question)
          }
        }}
        placeholder={started ? cs.chat.placeholderNext : cs.chat.placeholder}
        aria-label={cs.chat.questionLabel}
        maxLength={1000}
      />
      <button
        type="submit"
        className="button button--primary chat-composer__send"
        disabled={question.trim() === '' || waiting}
      >
        <Icon name="send" size={20} />
        {cs.chat.send}
      </button>
    </form>
  )

  return (
    <aside className="chat" aria-label={cs.chat.title}>
      <div className="chat__scope">
        <div className="chat__top">
          {/* An answer on its way would come into the new conversation, so the button waits for it. */}
          {started ? (
            <button
              type="button"
              className="link-button chat__new"
              onClick={startAgain}
              disabled={waiting}
            >
              <Icon name="plus" size={16} />
              {cs.chat.newChat}
            </button>
          ) : null}
          <button type="button" className="icon-button chat__close" onClick={onClose}>
            <Icon name="close" />
            <span className="visually-hidden">{cs.chat.close}</span>
          </button>
        </div>
        {/* With no document chosen there is no scope to show: the whole archive is searched. */}
        {chosen.length === 0 ? null : (
          <>
            <p>
              {cs.chat.scopeLabel}{' '}
              <strong>{fill(cs.chat.scopeLineDocuments, { count: chosen.length })}</strong>
            </p>
            <button type="button" className="link-button chat__remove-all" onClick={onUnchooseAll}>
              {cs.chat.scopeRemoveAll}
            </button>
          </>
        )}
        {chosen.length === 0 ? null : (
          <ul className="chat__chosen" aria-label={cs.chat.scopeChosen}>
            {chosen.map((document) => (
              <li key={document.id}>
                <Icon name="pdf" size={18} />
                <span>{document.title}</span>
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  onClick={() => onUnchoose(document.id)}
                  aria-label={`${cs.chat.scopeRemove}: ${document.title}`}
                >
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="chat__messages" role="log" aria-label={cs.chat.conversation}>
        {started ? null : (
          <div className="chat-start">
            {composer}
            <h3>{cs.chat.examplesTitle}</h3>
            <ul>
              {cs.chat.examples.map((example) => (
                <li key={example}>
                  <button type="button" className="chat-suggestion" onClick={() => ask(example)}>
                    <Icon name="chat" size={20} />
                    <span>{example}</span>
                    <Icon name="arrow" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((message) => {
          const sources = (message.sources ?? []).flatMap((source) => {
            const document = documents.find((candidate) => candidate.id === source.documentId)
            return document === undefined ? [] : [{ source, document }]
          })
          return (
            <article
              key={message.id}
              className={[
                `chat-message chat-message--${message.role}`,
                message.pending === true ? 'chat-message--pending' : '',
                message.failed === true ? 'chat-message--failed' : '',
              ].join(' ')}
              aria-busy={message.pending === true ? true : undefined}
            >
              <div className="chat-message__row">
                <span className="chat-message__avatar">
                  <Icon name={message.role === 'visitor' ? 'person' : 'chat'} size={22} />
                  <span className="visually-hidden">
                    {message.role === 'visitor' ? cs.chat.fromVisitor : cs.chat.fromArchive}
                  </span>
                </span>
                <p className="chat-message__text">{withReferences(message.text)}</p>
                {/* Right under the answer, and quiet on purpose: two small buttons nobody has to press. */}
                {message.traceId === undefined ? null : (
                  <div className="chat-feedback" role="group" aria-label={cs.chat.feedback.label}>
                    {([true, false] as const).map((helpful) => {
                      const traceId = message.traceId
                      const label = helpful ? cs.chat.feedback.yes : cs.chat.feedback.no
                      return traceId === undefined ? null : (
                        <button
                          key={String(helpful)}
                          type="button"
                          className="chat-feedback__answer"
                          aria-label={label}
                          title={label}
                          aria-pressed={message.helpful === helpful}
                          disabled={message.rating === 'storing'}
                          onClick={() => {
                            if (message.helpful !== helpful) rate(traceId, helpful)
                          }}
                        >
                          <Icon name={helpful ? 'thumbUp' : 'thumbDown'} size={16} />
                        </button>
                      )
                    })}
                    <span role="status">
                      {message.rating === 'thanked'
                        ? cs.chat.feedback.thanks
                        : message.rating === 'failed'
                          ? cs.chat.feedback.failed
                          : null}
                    </span>
                  </div>
                )}
              </div>

              {sources.length === 0 ? null : (
                <div className="chat-sources">
                  <h3>{cs.chat.sources}</h3>
                  <ol>
                    {sources.map(({ source, document }) => (
                      <li key={`${source.documentId}-${source.page ?? 0}`}>
                        <FileBadge mimeType={document.mimeType} small />
                        <p className="chat-sources__title">
                          <strong>{document.title}</strong>
                          {source.page === undefined
                            ? null
                            : ` · ${fill(cs.chat.page, { page: source.page })}`}
                        </p>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onOpenSource(source)}
                          aria-label={`${cs.chat.open}: ${document.title}`}
                        >
                          {cs.chat.open}
                          <Icon name="open" />
                        </button>
                      </li>
                    ))}
                  </ol>
                  <p className="chat-sources__check">
                    <Icon name="info" />
                    {cs.chat.verify}
                  </p>
                </div>
              )}
            </article>
          )
        })}
        <div ref={end} />
      </div>

      {started ? composer : null}
    </aside>
  )
}
