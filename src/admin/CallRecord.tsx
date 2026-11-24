import type { RecordedCall } from '~/ai/types'
import { formatUsd } from '~/archive/format'
import { cs, fill } from '~/copy/cs'

const count = new Intl.NumberFormat('cs-CZ')
const seconds = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 })

/** One call to a model: which model and skill, what it got, what it returned and what it cost. */
export function CallRecord({ call }: Readonly<{ call: RecordedCall }>) {
  // A record from before a call was told more skills names one skill only.
  const skill =
    call.skills !== null || call.use === null
      ? null
      : call.skillVersion === 0
        ? fill(cs.calls.skillDefault, { key: call.use })
        : fill(cs.calls.skill, { key: call.use, version: call.skillVersion })
  const facts = [
    call.model,
    skill,
    call.page === null ? null : fill(cs.calls.page, { page: call.page }),
    fill(cs.calls.tokens, {
      input: count.format(call.inputTokens),
      output: count.format(call.outputTokens),
    }),
    fill(cs.calls.duration, { seconds: seconds.format(call.durationMs / 1000) }),
    call.costUsd === null ? cs.costs.unknownPrice : formatUsd(call.costUsd),
  ].filter((fact) => fact !== null)

  return (
    <li className={call.error === null ? 'call' : 'call call--failed'}>
      <h3>{cs.calls.operations[call.operation]}</h3>
      <ul className="call__facts">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      {call.skills === null || call.skills.length === 0 ? null : (
        <>
          <h4>{cs.calls.skills}</h4>
          <ul className="call__skills">
            {call.skills.map((used) => (
              <li key={used.key}>
                <code>{used.key}</code>
                <span>
                  {used.version === 0
                    ? cs.calls.skillVersionDefault
                    : fill(cs.calls.skillVersion, { version: used.version })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>{cs.calls.input}</h4>
      <p className="extracted-text">{call.input}</p>
      {call.error === null ? (
        <>
          <h4>{cs.calls.output}</h4>
          <p className="extracted-text">{call.output}</p>
        </>
      ) : (
        <>
          <h4>{cs.calls.error}</h4>
          <p className="extracted-text call__error">{call.error}</p>
        </>
      )}
    </li>
  )
}
