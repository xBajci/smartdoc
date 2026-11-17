import type { SortOrder } from '~/archive/types'
import { cs, fill } from '~/copy/cs'
import { Icon } from './Icon'

interface SortHeaderProps {
  label: string
  /** The order a first click gives, and the one a second click turns it into. */
  first: SortOrder
  second: SortOrder
  order: SortOrder
  onSort: (order: SortOrder) => void
  className?: string
}

/** The head of a column that orders its table: a click sorts by it, the next one turns the order. */
export function SortHeader({
  label,
  first,
  second,
  order,
  onSort,
  className,
}: Readonly<SortHeaderProps>) {
  const active = order === first || order === second
  // Dates read newest first by default, so there the first click is the descending one.
  const ascending = order === (first === 'nove' ? second : first)
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        className="sort-header"
        aria-label={fill(cs.library.sortBy, { column: label })}
        onClick={() => onSort(order === first ? second : first)}
      >
        {label}
        <Icon name={active ? (ascending ? 'up' : 'down') : 'sort'} size={16} />
      </button>
    </th>
  )
}
