import { createFileRoute } from '@tanstack/react-router'
import { formatUsd } from '~/archive/format'
import type { DocumentFormat, UsageTotals } from '~/archive/types'
import { cs } from '~/copy/cs'
import { getUsageFn } from '~/server/archive'

export const Route = createFileRoute('/sprava/naklady')({
  loader: () => getUsageFn(),
  component: AdminCosts,
})

const count = new Intl.NumberFormat('cs-CZ')
const dateTime = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })

/** A call that read no document is the optimizer. */
function formatName(format: DocumentFormat | null) {
  if (format === null) return cs.costs.formatNone
  return format === 'pdf' ? cs.costs.formatPdf : cs.costs.formatImage
}

/** A sum that misses every call is not a price; say so instead of showing zero. */
function cost(totals: UsageTotals) {
  return totals.unpricedCalls === totals.calls ? cs.costs.unknownPrice : formatUsd(totals.costUsd)
}

function average(totals: UsageTotals) {
  return totals.unpricedCalls === totals.calls || totals.runs === 0
    ? cs.costs.unknownPrice
    : formatUsd(totals.costUsd / totals.runs)
}

function AdminCosts() {
  const report = Route.useLoaderData()
  // A visitor gets no report; the layout above already shows the sign-in form.
  if (report === null) return null

  return (
    <section className="admin-section" aria-labelledby="admin-costs-title">
      <div className="admin-section__head">
        <h1 id="admin-costs-title">{cs.admin.navCosts}</h1>
      </div>
      <p className="field-hint">{cs.costs.intro}</p>

      {report.total.calls === 0 ? (
        <p className="notice">{cs.costs.empty}</p>
      ) : (
        <>
          <dl className="cost-summary">
            <div>
              <dt>{cs.costs.total}</dt>
              <dd>{cost(report.total)}</dd>
            </div>
            <div>
              <dt>{cs.costs.totalRuns}</dt>
              <dd>{count.format(report.total.runs)}</dd>
            </div>
            <div>
              <dt>{cs.costs.totalAverage}</dt>
              <dd>{average(report.total)}</dd>
            </div>
          </dl>
          {report.total.unpricedCalls === 0 ? null : (
            <p className="attention">{cs.costs.unpricedNote}</p>
          )}

          <h2 className="admin-section__subtitle">{cs.costs.byModelTitle}</h2>
          <div className="cost-table__wrap">
            <table className="document-table admin-table cost-table">
              <thead>
                <tr>
                  <th scope="col">{cs.costs.columnModel}</th>
                  <th scope="col" className="cost-table__text">
                    {cs.costs.columnFormat}
                  </th>
                  <th scope="col">{cs.costs.columnRuns}</th>
                  <th scope="col">{cs.costs.columnCalls}</th>
                  <th scope="col">{cs.costs.columnInput}</th>
                  <th scope="col">{cs.costs.columnOutput}</th>
                  <th scope="col">{cs.costs.columnCost}</th>
                  <th scope="col">{cs.costs.columnAverage}</th>
                </tr>
              </thead>
              <tbody>
                {report.groups.map((group) => (
                  <tr key={`${group.model} ${group.format}`}>
                    <th scope="row">{group.model}</th>
                    <td className="cost-table__text">{formatName(group.format)}</td>
                    <td>{count.format(group.runs)}</td>
                    <td>{count.format(group.calls)}</td>
                    <td>{count.format(group.inputTokens)}</td>
                    <td>{count.format(group.outputTokens)}</td>
                    <td>{cost(group)}</td>
                    <td>{average(group)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="admin-section__subtitle">{cs.costs.runsTitle}</h2>
          <div className="cost-table__wrap">
            <table className="document-table admin-table cost-table">
              <thead>
                <tr>
                  <th scope="col">{cs.costs.columnDocument}</th>
                  <th scope="col" className="cost-table__text">
                    {cs.costs.columnFormat}
                  </th>
                  <th scope="col" className="cost-table__text">
                    {cs.costs.columnWhen}
                  </th>
                  <th scope="col" className="cost-table__text">
                    {cs.costs.columnModel}
                  </th>
                  <th scope="col">{cs.costs.columnCalls}</th>
                  <th scope="col">{cs.costs.columnInput}</th>
                  <th scope="col">{cs.costs.columnOutput}</th>
                  <th scope="col">{cs.costs.columnCost}</th>
                </tr>
              </thead>
              <tbody>
                {report.runs.map((run) => (
                  <tr key={run.runId}>
                    <th scope="row">{run.documentTitle}</th>
                    <td className="cost-table__text">{formatName(run.format)}</td>
                    <td className="cost-table__text">{dateTime.format(new Date(run.at))}</td>
                    <td className="cost-table__text">{run.models.join(', ')}</td>
                    <td>{count.format(run.calls)}</td>
                    <td>{count.format(run.inputTokens)}</td>
                    <td>{count.format(run.outputTokens)}</td>
                    <td>{cost(run)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
