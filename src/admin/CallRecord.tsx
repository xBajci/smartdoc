import { formatUsd } from '~/archive/format'
import type { SessionCall } from '~/archive/types'
import { cs, fill } from '~/copy/cs'

const count = new Intl.NumberFormat('cs-CZ')
const seconds = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 })

/** One call to a model: which model and skill, what it got, what it returned and what it cost. */
export function CallRecord({ call }: Readonly<{ call: SessionCall }>) {
  // A record from before a call was told more skills names one skill only.
  const skill =
    call.skills !== null || call.skillKey === null
      ? null
      : call.skillVersion === 0
        ? fill(cs.sessions.skillDefault, { key: call.skillKey })
        : fill(cs.sessions.skill, { key: call.skillKey, version: call.skillVersion })
  const facts = [
    call.model,
    skill,
    call.page === null ? null : fill(cs.sessions.page, { page: call.page }),
    fill(cs.sessions.tokens, {
      input: count.format(call.inputTokens),
      output: count.format(call.outputTokens),
    }),
    fill(cs.sessions.duration, { seconds: seconds.format(call.durationMs / 1000) }),
    call.costUsd === null ? cs.costs.unknownPrice : formatUsd(call.costUsd),
  ].filter((fact) => fact !== null)

  return (
    <li className={call.error === null ? 'call' : 'call call--failed'}>
      <h3>{cs.sessions.operations[call.operation]}</h3>
      <ul className="call__facts">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      {call.skills === null || call.skills.length === 0 ? null : (
        <>
          <h4>{cs.sessions.skills}</h4>
          <ul className="call__skills">
            {call.skills.map((used) => (
              <li key={used.key}>
                <code>{used.key}</code>
                <span>
                  {used.version === 0
                    ? cs.sessions.skillVersionDefault
                    : fill(cs.sessions.skillVersion, { version: used.version })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>{cs.sessions.input}</h4>
      <p className="extracted-text">{call.input}</p>
      {call.error === null ? (
        <>
          <h4>{cs.sessions.output}</h4>
          <p className="extracted-text">{call.output}</p>
        </>
      ) : (
        <>
          <h4>{cs.sessions.error}</h4>
          <p className="extracted-text call__error">{call.error}</p>
        </>
      )}
    </li>
  )
}
