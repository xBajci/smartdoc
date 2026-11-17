import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { formatUsd } from '~/archive/format'
import type {
  ChatHit,
  ChatSessionSummary,
  ChatTrace,
  ChatTraceStep,
  ChatTraceSummary,
} from '~/archive/types'
import { Icon } from '~/components/Icon'
import { cs, fill } from '~/copy/cs'
import { askArchiveFn, getChatSessionFn, getChatSessionsFn, getChatTraceFn } from '~/server/archive'

export const Route = createFileRoute('/sprava/chat')({
  loader: () => getChatSessionsFn(),
  component: ChatDebugger,
})

const dateTime = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'medium' })
const count = new Intl.NumberFormat('cs-CZ')
const seconds = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 })
const score = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 4 })
const weight = new Intl.NumberFormat('cs-CZ', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const percent = (share: number) => Math.round(share * 100)

/** Mean of the scores that are known, or `null` when none is. */
function mean(scores: readonly (number | null)[]): number | null {
  const known = scores.filter((value) => value !== null)
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length
}
const average = (scores: readonly (number | null)[]) => weight.format(mean(scores) ?? 0)

const took = (ms: number) => fill(cs.chatDebug.duration, { seconds: seconds.format(ms / 1000) })
const cost = (usd: number | null) => (usd === null ? cs.costs.unknownPrice : formatUsd(usd))

function Facts({ facts }: Readonly<{ facts: readonly (string | null)[] }>) {
  return (
    <ul className="call__facts">
      {facts
        .filter((fact) => fact !== null)
        .map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
    </ul>
  )
}

function Branch({
  title,
  scoreLabel,
  hits,
}: Readonly<{ title: string; scoreLabel: string; hits: readonly ChatHit[] }>) {
  return (
    <div className="trace-branch">
      <h4>{title}</h4>
      {hits.length === 0 ? (
        <p className="field-hint">{cs.chatDebug.nothing}</p>
      ) : (
        <table className="trace-table">
          <thead>
            <tr>
              <th scope="col">{cs.chatDebug.columnRank}</th>
              <th scope="col">{cs.chatDebug.columnDocument}</th>
              <th scope="col">{cs.chatDebug.columnPage}</th>
              <th scope="col">{scoreLabel}</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((hit) => (
              <tr key={hit.chunkId}>
                <td>{hit.rank}</td>
                <td>{hit.documentTitle}</td>
                <td>{hit.page ?? '–'}</td>
                <td>{score.format(hit.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Step({ step }: Readonly<{ step: ChatTraceStep }>) {
  if (step.kind === 'model') {
    return (
      <li className="call trace-step trace-step--model">
        <h3>{fill(cs.chatDebug.modelStep, { step: step.step })}</h3>
        <Facts
          facts={[
            step.model,
            fill(cs.chatDebug.tokens, {
              input: count.format(step.inputTokens),
              output: count.format(step.outputTokens),
            }),
            took(step.durationMs),
            cost(step.costUsd),
          ]}
        />
        {step.searches.map((query) => (
          <p key={query} className="trace-step__asks">
            <Icon name="search" size={15} />
            {cs.chatDebug.asksSearch}: <strong>{query}</strong>
          </p>
        ))}
        {step.text === '' ? null : (
          <>
            <h4>{cs.chatDebug.modelText}</h4>
            <p className="extracted-text">{step.text}</p>
          </>
        )}
      </li>
    )
  }

  const { weights, rerank, baseline } = step
  const reranked = rerank !== undefined && rerank.error === null
  const rank = (value: number | null) =>
    value === null ? cs.chatDebug.notFoundByBranch : String(value)
  return (
    <li className="call trace-step trace-step--search">
      <h3>{fill(cs.chatDebug.searchStep, { query: step.query })}</h3>
      <Facts
        facts={[
          took(step.durationMs),
          fill(cs.chatDebug.embeddingTokens, { tokens: count.format(step.embeddingTokens) }),
        ]}
      />
      {weights === undefined ? null : (
        <div className="trace-decision">
          <h4>
            {fill(cs.chatDebug.weights, {
              words: weight.format(weights.words),
              meaning: weight.format(weights.meaning),
            })}
          </h4>
          {weights.error === null ? (
            <Facts
              facts={[
                weights.model,
                fill(cs.chatDebug.weightsWhy, {
                  exact: percent(weights.exact),
                  both: percent(weights.both),
                  paraphrase: percent(weights.paraphrase),
                }),
                weights.durationMs === undefined ? null : took(weights.durationMs),
                weights.costUsd === undefined ? null : cost(weights.costUsd),
              ]}
            />
          ) : (
            <p className="extracted-text call__error">
              {cs.chatDebug.weightsFailed}: {weights.error}
            </p>
          )}
        </div>
      )}
      <div className="trace-branches">
        <Branch
          title={cs.chatDebug.wordsBranch}
          scoreLabel={cs.chatDebug.columnScore}
          hits={step.words}
        />
        <Branch
          title={cs.chatDebug.meaningBranch}
          scoreLabel={cs.chatDebug.columnDistance}
          hits={step.meaning}
        />
      </div>
      {rerank === undefined ? null : (
        <div className="trace-decision">
          <h4>{cs.chatDebug.rerank}</h4>
          {rerank.error === null ? (
            <>
              <Facts
                facts={[
                  rerank.model,
                  fill(cs.chatDebug.tokens, {
                    input: count.format(rerank.inputTokens),
                    output: count.format(rerank.outputTokens),
                  }),
                  took(rerank.durationMs),
                  cost(rerank.costUsd),
                ]}
              />
              <table className="trace-table">
                <thead>
                  <tr>
                    <th scope="col">{cs.chatDebug.columnRerank}</th>
                    <th scope="col">{cs.chatDebug.columnPlainRank}</th>
                    <th scope="col">{cs.chatDebug.columnFusedRank}</th>
                    <th scope="col">{cs.chatDebug.columnDocument}</th>
                    <th scope="col">{cs.chatDebug.columnPage}</th>
                    <th scope="col">{cs.chatDebug.columnKept}</th>
                    <th scope="col">{cs.chatDebug.columnBaselineKept}</th>
                  </tr>
                </thead>
                <tbody>
                  {rerank.candidates.map((candidate) => (
                    <tr key={candidate.chunkId}>
                      <td>{score.format(candidate.score)}</td>
                      <td>{candidate.plainRank ?? '–'}</td>
                      <td>{candidate.fusedRank}</td>
                      <td>{candidate.documentTitle}</td>
                      <td>{candidate.page ?? '–'}</td>
                      <td>{candidate.kept ? cs.chatDebug.kept : cs.chatDebug.dropped}</td>
                      <td>
                        {candidate.baselineKept === true ? cs.chatDebug.kept : cs.chatDebug.dropped}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="extracted-text call__error">
              {cs.chatDebug.rerankFailed}: {rerank.error}
            </p>
          )}
        </div>
      )}
      <h4>{reranked ? cs.chatDebug.fusedReranked : cs.chatDebug.fused}</h4>
      {step.passages.length === 0 ? (
        <p className="field-hint">{cs.chatDebug.nothing}</p>
      ) : (
        <ol className="trace-passages">
          {step.passages.map((passage) => (
            <li key={passage.chunkId}>
              <details>
                <summary>
                  <strong>
                    {fill(cs.chatDebug.passage, {
                      number: passage.number,
                      title: passage.documentTitle,
                    })}
                  </strong>
                  {passage.page === null ? null : (
                    <span>{fill(cs.chatDebug.passagePage, { page: passage.page })}</span>
                  )}
                  <span>
                    {fill(cs.chatDebug.passageRanks, {
                      words: rank(passage.wordRank),
                      meaning: rank(passage.meaningRank),
                      score: score.format(passage.fusedScore),
                    })}
                  </span>
                  {passage.rerankScore === undefined || passage.fusedRank === undefined ? null : (
                    <span>
                      {fill(cs.chatDebug.passageRerank, {
                        rank: passage.fusedRank,
                        score: score.format(passage.rerankScore),
                      })}
                    </span>
                  )}
                </summary>
                <p className="extracted-text">{passage.text}</p>
              </details>
            </li>
          ))}
        </ol>
      )}
      {baseline === undefined || baseline.length === 0 ? null : (
        <div className="trace-decision trace-compare">
          <h4>{cs.chatDebug.compare}</h4>
          {mean(baseline.map((item) => item.score)) === null ? null : (
            <p className="field-hint">
              {fill(cs.chatDebug.compareSame, {
                same: baseline.filter((item) => item.kept).length,
                total: baseline.length,
                with: average(step.passages.map((passage) => passage.rerankScore ?? null)),
                without: average(baseline.map((item) => item.score)),
              })}
            </p>
          )}
          <ol className="trace-passages">
            {baseline.map((item) => (
              <li key={item.chunkId}>
                <details>
                  <summary>
                    <strong>
                      {fill(cs.chatDebug.baselinePassage, {
                        rank: item.rank,
                        title: item.documentTitle,
                      })}
                    </strong>
                    {item.page === null ? null : (
                      <span>{fill(cs.chatDebug.passagePage, { page: item.page })}</span>
                    )}
                    {item.score === null ? null : (
                      <span>
                        {fill(cs.chatDebug.baselineScore, { score: score.format(item.score) })}
                      </span>
                    )}
                    <span>{item.kept ? cs.chatDebug.compareBoth : cs.chatDebug.compareOnly}</span>
                  </summary>
                  <p className="extracted-text">{item.text}</p>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  )
}

function TraceDetail({ trace }: Readonly<{ trace: ChatTrace }>) {
  const { instructions, ...numbers } = trace.setup
  return (
    <div className="trace">
      <Facts
        facts={[
          trace.model,
          trace.scope === 'archive' ? cs.chatDebug.scopeArchive : cs.chatDebug.scopeDocuments,
          took(trace.durationMs),
          cost(trace.costUsd),
        ]}
      />
      <div className="call">
        <h3>{cs.chatDebug.history}</h3>
        {trace.history.length === 0 ? (
          <p className="field-hint">{cs.chatDebug.noHistory}</p>
        ) : (
          <ol className="trace-history">
            {trace.history.map((turn, index) => (
              // Turns of a stored history never change order.
              <li key={index}>
                <h4>
                  {turn.role === 'visitor'
                    ? cs.chatDebug.historyVisitor
                    : cs.chatDebug.historyArchive}
                </h4>
                <p className="extracted-text">{turn.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
      <ol className="session__calls">
        {trace.steps.map((step, index) => (
          // Steps of a stored trace never change order.
          <Step key={index} step={step} />
        ))}
      </ol>
      <div className={trace.error === null ? 'call' : 'call call--failed'}>
        <h3>{cs.chatDebug.answer}</h3>
        <p className="extracted-text">
          {trace.answer === '' ? cs.chatDebug.noAnswer : trace.answer}
        </p>
        {trace.error === null ? null : (
          <>
            <h4>{cs.chatDebug.error}</h4>
            <p className="extracted-text call__error">{trace.error}</p>
          </>
        )}
      </div>
      <details className="trace-setup">
        <summary>{cs.chatDebug.setup}</summary>
        <p className="field-hint">{cs.chatDebug.whereToChange}</p>
        <table className="trace-table">
          <tbody>
            {Object.entries(numbers).map(([name, value]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="extracted-text">{instructions}</p>
      </details>
    </div>
  )
}

function Trace({ summary, open }: Readonly<{ summary: ChatTraceSummary; open: boolean }>) {
  /** `undefined` until opened, `null` when the trace could not be read. */
  const [trace, setTrace] = useState<ChatTrace | null | undefined>(undefined)

  function load() {
    if (trace !== undefined) return
    getChatTraceFn({ data: { id: summary.id } }).then(setTrace, () => setTrace(null))
  }

  return (
    <li className="session">
      <details
        open={open ? true : undefined}
        ref={(element) => {
          if (element?.open === true) load()
        }}
        onToggle={(event) => {
          if (event.currentTarget.open) load()
        }}
      >
        <summary aria-label={`${cs.chatDebug.show}: ${summary.question}`}>
          <strong className="session__title">{summary.question}</strong>
          <span>{dateTime.format(new Date(summary.at))}</span>
          <span>{fill(cs.chatDebug.searches, { count: summary.searches })}</span>
          <span>{took(summary.durationMs)}</span>
          {summary.failed ? (
            <span className="status status--failed">
              <Icon name="alert" size={15} />
              {cs.chatDebug.failed}
            </span>
          ) : null}
          <span className="session__cost">{cost(summary.costUsd)}</span>
        </summary>
        {trace === undefined ? (
          <p className="field-hint">{cs.chatDebug.loading}</p>
        ) : trace === null ? (
          <p className="field-error">{cs.chatDebug.missing}</p>
        ) : (
          <TraceDetail trace={trace} />
        )}
      </details>
    </li>
  )
}

/** One conversation in the list; a click opens it. */
function SessionRow({
  session,
  onOpen,
}: Readonly<{ session: ChatSessionSummary; onOpen: (sessionId: string) => void }>) {
  return (
    <li className="session">
      <button
        type="button"
        className="session__open"
        aria-label={`${cs.chatDebug.openSession}: ${session.firstQuestion}`}
        onClick={() => onOpen(session.sessionId)}
      >
        <strong className="session__title">{session.firstQuestion}</strong>
        <span>{dateTime.format(new Date(session.lastAt))}</span>
        <span>{fill(cs.chatDebug.questions, { count: session.questions })}</span>
        <span>{took(session.durationMs)}</span>
        {session.failed ? (
          <span className="status status--failed">
            <Icon name="alert" size={15} />
            {cs.chatDebug.failed}
          </span>
        ) : null}
        <span className="session__cost">{cost(session.costUsd)}</span>
      </button>
    </li>
  )
}

/** The session id, ready to be put where a question can continue the conversation. */
function SessionId({ id }: Readonly<{ id: string }>) {
  const [copied, setCopied] = useState(false)
  return (
    <p className="trace-session__id">
      <span>{cs.chatDebug.sessionId}:</span>
      <code>{id}</code>
      <button
        type="button"
        className="button button--small"
        onClick={() => {
          navigator.clipboard.writeText(id).then(
            () => setCopied(true),
            () => undefined,
          )
        }}
      >
        {copied ? cs.chatDebug.copied : cs.chatDebug.copyId}
      </button>
    </p>
  )
}

/** The conversation the administrator is looking at. */
interface OpenSession {
  id: string
  /** `undefined` until read, `null` when the session could not be read. */
  traces: ChatTraceSummary[] | null | undefined
}

function ChatDebugger() {
  const sessions = Route.useLoaderData()
  const router = useRouter()
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [session, setSession] = useState<OpenSession | null>(null)
  /** The trace of the question just tried; it is shown open. */
  const [opened, setOpened] = useState<string | null>(null)

  // A visitor gets no records; the layout above already shows the sign-in form.
  if (sessions === null) return null

  async function openSession(id: string) {
    setSession({ id, traces: undefined })
    // The administrator may have moved on while the session was being read.
    const keep = (traces: OpenSession['traces']) =>
      setSession((current) => (current?.id === id ? { id, traces } : current))
    try {
      keep(await getChatSessionFn({ data: { sessionId: id } }))
    } catch {
      keep(null)
    }
  }

  function closeSession() {
    setSession(null)
    setOpened(null)
  }

  async function tryQuestion(event: FormEvent) {
    event.preventDefault()
    const asked = question.trim()
    if (asked === '' || asking) return
    setAsking(true)
    setMessage(null)
    try {
      const answer = await askArchiveFn({
        data: { question: asked, sessionId: session?.id, scope: 'archive', documentIds: [] },
      })
      if (answer.ok) {
        setOpened(answer.traceId)
        await openSession(answer.sessionId)
      } else {
        setMessage(
          answer.problem === 'failed'
            ? cs.chatDebug.tryFailed
            : fill(cs.chatDebug.tryRefused, { reason: cs.chat.problems[answer.problem] }),
        )
        // A failed question is in the open session too; a new session is not known by id.
        if (session !== null) await openSession(session.id)
      }
      setQuestion('')
      await router.invalidate()
    } catch {
      setMessage(cs.admin.actionFailed)
    } finally {
      setAsking(false)
    }
  }

  return (
    <section className="admin-section" aria-labelledby="admin-chat-title">
      <div className="admin-section__head">
        <h1 id="admin-chat-title">{cs.admin.navChat}</h1>
      </div>
      <p className="admin-section__intro">{cs.chatDebug.intro}</p>

      <form className="trace-try" onSubmit={(event) => void tryQuestion(event)}>
        <label className="search-field">
          <Icon name="chat" />
          <span className="visually-hidden">{cs.chatDebug.tryLabel}</span>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={cs.chatDebug.tryPlaceholder}
            maxLength={1000}
          />
        </label>
        <button
          type="submit"
          className="button button--primary"
          disabled={question.trim() === '' || asking}
        >
          {asking ? cs.chatDebug.trying : cs.chatDebug.tryAction}
        </button>
        {session === null ? null : (
          <button type="button" className="button" onClick={closeSession} disabled={asking}>
            {cs.chatDebug.newConversation}
          </button>
        )}
      </form>
      {session === null ? null : <p className="field-hint">{cs.chatDebug.tryContinues}</p>}
      <p className="flash" role="status">
        {message}
      </p>

      {session !== null ? (
        <section className="trace-session" aria-labelledby="admin-session-title">
          <h2 id="admin-session-title">{cs.chatDebug.sessionTitle}</h2>
          <SessionId id={session.id} />
          {session.traces === undefined ? (
            <p className="field-hint">{cs.chatDebug.loading}</p>
          ) : session.traces === null || session.traces.length === 0 ? (
            <p className="field-error">{cs.chatDebug.sessionMissing}</p>
          ) : (
            <ul className="sessions">
              {session.traces.map((summary) => (
                <Trace key={summary.id} summary={summary} open={summary.id === opened} />
              ))}
            </ul>
          )}
        </section>
      ) : sessions.length === 0 ? (
        <p className="notice">{cs.chatDebug.empty}</p>
      ) : (
        <ul className="sessions">
          {sessions.map((summary) => (
            <SessionRow
              key={summary.sessionId}
              session={summary}
              onOpen={(id) => void openSession(id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
