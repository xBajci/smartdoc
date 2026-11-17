import { useEffect, useState } from 'react'
import { formatUsd } from '~/archive/format'
import type { DocumentDebug, ProcessingRun } from '~/archive/types'
import { Icon } from '~/components/Icon'
import { cs, fill } from '~/copy/cs'
import { getDocumentDebugFn } from '~/server/archive'
import { CallRecord } from './CallRecord'

const dateTime = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'medium' })
const count = new Intl.NumberFormat('cs-CZ')
const seconds = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 })

interface DebugPanelProps {
  /** The document chosen in the list; `null` when none is. */
  documentId: string | null
  /** Changes whenever the archive does, so a finished run shows without a new click. */
  revision: number
  onClose: () => void
}

/**
 * The right panel of the list of processing. For the chosen document it shows
 * every run step by step: what processing did, each model call with its input,
 * output, tokens and price, and what was stored where.
 */
export function DebugPanel({ documentId, revision, onClose }: Readonly<DebugPanelProps>) {
  /** `undefined` while it is read, `null` when it could not be. */
  const [debug, setDebug] = useState<DocumentDebug | null>()

  useEffect(() => {
    if (documentId === null) return
    let current = true
    // The record of another document must not stay under the new name.
    setDebug((shown) => (shown?.documentId === documentId ? shown : undefined))
    getDocumentDebugFn({ data: { id: documentId } }).then(
      (answer) => {
        if (current) setDebug(answer)
      },
      () => {
        if (current) setDebug(null)
      },
    )
    return () => {
      current = false
    }
  }, [documentId, revision])

  const shown = documentId === null ? undefined : (debug ?? undefined)

  return (
    <aside className="chat debug" aria-label={cs.debug.title}>
      <div className="debug__head">
        {/* One line for the document and one for the sums of all its runs. */}
        <div className="debug__title">
          <h2 title={shown?.title}>{shown?.title ?? cs.debug.title}</h2>
          {shown === undefined ? null : (
            <p>
              <span className="document-filename">{shown.originalFilename}</span>
              <span>{fill(cs.debug.totalRuns, { count: shown.runs.length })}</span>
              <span>
                {fill(cs.debug.totalCost, {
                  cost: formatUsd(shown.runs.reduce((sum, run) => sum + run.costUsd, 0)),
                })}
              </span>
            </p>
          )}
        </div>
        <button type="button" className="icon-button chat__close" onClick={onClose}>
          <Icon name="close" />
          <span className="visually-hidden">{cs.debug.close}</span>
        </button>
      </div>
      <div className="debug__body">
        {documentId === null ? (
          <div className="debug__empty">
            <p>
              <strong>{cs.debug.empty}</strong>
            </p>
            <p>{cs.debug.emptyHint}</p>
          </div>
        ) : debug === undefined ? (
          <p className="field-hint" role="status">
            {cs.debug.loading}
          </p>
        ) : debug === null ? (
          <p className="field-hint" role="alert">
            {cs.debug.failed}
          </p>
        ) : (
          <>
            {debug.runs.length === 0 ? (
              <p className="notice">{cs.debug.noRuns}</p>
            ) : (
              debug.runs.map((run, index) => <Run key={run.runId} run={run} open={index === 0} />)
            )}

            <details className="debug-card">
              <summary>
                <strong>{cs.debug.stored}</strong>
              </summary>
              <p className="field-hint">{cs.debug.storedHint}</p>
              <dl className="debug-values">
                {debug.stored.map((item) => (
                  <Stored key={item.target} {...item} />
                ))}
              </dl>
            </details>
          </>
        )}
      </div>
    </aside>
  )
}

function Stored({ target, value }: Readonly<{ target: string; value: string }>) {
  return (
    <div>
      <dt>{target}</dt>
      <dd>{value === '' ? '""' : value}</dd>
    </div>
  )
}

function Run({ run, open }: Readonly<{ run: ProcessingRun; open: boolean }>) {
  // Each "call" step takes the next call of the run, in the order they were made.
  const callOfStep: (number | null)[] = []
  for (const step of run.steps) {
    const made = callOfStep.filter((index) => index !== null).length
    callOfStep.push(step.kind === 'call' ? made : null)
  }
  const facts = [
    {
      label: cs.debug.summaryDuration,
      value:
        run.durationMs === null
          ? '–'
          : fill(cs.sessions.duration, { seconds: seconds.format(run.durationMs / 1000) }),
    },
    { label: cs.debug.summaryCalls, value: count.format(run.calls.length) },
    {
      label: cs.debug.summaryTokens,
      value: fill(cs.debug.tokens, {
        input: count.format(run.inputTokens),
        output: count.format(run.outputTokens),
      }),
    },
    {
      label: cs.debug.summaryCost,
      value:
        run.calls.length > 0 && run.unpricedCalls === run.calls.length
          ? cs.costs.unknownPrice
          : formatUsd(run.costUsd),
    },
  ]

  return (
    <details className="debug-card debug-run" open={open}>
      <summary>
        <strong>{fill(cs.debug.run, { at: dateTime.format(new Date(run.at)) })}</strong>
        {run.outcome === null ? null : (
          <span
            className={run.outcome === 'ready' ? 'status status--ready' : 'status status--failed'}
          >
            {run.outcome === 'ready' ? cs.debug.outcomeReady : cs.debug.outcomeFailed}
          </span>
        )}
      </summary>
      <dl className="debug-facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {run.outcome === null ? <p className="field-hint">{cs.debug.oldRun}</p> : null}

      <h4 className="debug__label">{cs.debug.steps}</h4>
      <ol className="debug-steps">
        {run.steps.map((step, index) => {
          if (step.kind === 'call') {
            const call = run.calls[callOfStep[index] ?? -1]
            return call === undefined ? (
              <li key={index} className="call call--failed">
                {cs.debug.missingCall}
              </li>
            ) : (
              <CallRecord key={index} call={call} />
            )
          }
          if (step.kind === 'saved') {
            return (
              <li key={index} className="debug-step debug-step--saved">
                <h3>{cs.debug.saved}</h3>
                <dl className="debug-values">
                  <Stored target={step.target} value={step.value} />
                </dl>
              </li>
            )
          }
          return (
            <li key={index} className="debug-step">
              <h3>{step.title}</h3>
              {step.detail === '' ? null : <p>{step.detail}</p>}
            </li>
          )
        })}
      </ol>
    </details>
  )
}
