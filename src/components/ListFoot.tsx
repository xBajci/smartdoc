import { plural } from '~/archive/format'
import { PAGE_SIZES } from '~/archive/query'
import { cs, fill } from '~/copy/cs'
import { Pager } from './Pager'

interface ListFootProps {
  /** How many documents match, over all pages. */
  total: number
  /** How many of them the page shows. */
  shown: number
  page: number
  pageCount: number
  pageSize: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}

/** What stands under a list: which documents it shows, how many rows a page has, and the pages. */
export function ListFoot({
  total,
  shown,
  page,
  pageCount,
  pageSize,
  onPage,
  onPageSize,
}: Readonly<ListFootProps>) {
  const from = (page - 1) * pageSize + 1
  return (
    <div className="list-foot">
      <p className="list-foot__count" role="status">
        {fill(cs.pager.range, {
          from,
          to: from + shown - 1,
          total: plural(total, 'dokumentu', 'dokumentů', 'dokumentů'),
        })}
      </p>
      <label className="list-foot__size">
        {cs.pager.pageSize}
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <Pager page={page} pageCount={pageCount} onChange={onPage} />
    </div>
  )
}
