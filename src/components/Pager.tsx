import { cs, fill } from '~/copy/cs'
import { Icon } from './Icon'

interface PagerProps {
  page: number
  pageCount: number
  onChange: (page: number) => void
}

/** The pages to offer: the first, the last and the neighbours of the current one; `null` is a gap. */
export function pagesToOffer(page: number, pageCount: number): (number | null)[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1])
  const pages = [...wanted].filter((item) => item >= 1 && item <= pageCount).sort((a, b) => a - b)
  const offered: (number | null)[] = []
  for (const item of pages) {
    const previous = offered.at(-1)
    if (typeof previous === 'number' && item - previous === 2) offered.push(previous + 1)
    else if (typeof previous === 'number' && item - previous > 2) offered.push(null)
    offered.push(item)
  }
  return offered
}

/** Moves between the pages of a list. Shows nothing when the list fits on one page. */
export function Pager({ page, pageCount, onChange }: Readonly<PagerProps>) {
  if (pageCount <= 1) return null
  return (
    <nav className="pager" aria-label={cs.pager.label}>
      <button
        type="button"
        className="pager__step"
        disabled={page <= 1}
        aria-label={cs.pager.previous}
        onClick={() => onChange(page - 1)}
      >
        <Icon name="previous" size={18} />
      </button>
      <ol className="pager__pages">
        {pagesToOffer(page, pageCount).map((item, index) =>
          item === null ? (
            // A gap stands between two fixed neighbours, so its place names it.
            <li key={`gap-${index}`} className="pager__gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                className="pager__page"
                aria-label={fill(cs.pager.page, { page: item })}
                aria-current={item === page ? 'page' : undefined}
                onClick={() => onChange(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ol>
      <button
        type="button"
        className="pager__step"
        disabled={page >= pageCount}
        aria-label={cs.pager.next}
        onClick={() => onChange(page + 1)}
      >
        <Icon name="next" size={18} />
      </button>
    </nav>
  )
}
