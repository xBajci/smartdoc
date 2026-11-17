import { useEffect, useMemo, useRef, useState } from 'react'
import { plural } from '~/archive/format'
import { libraryOrder, hasActiveFilters, LIST_STEP, MAX_LIST_ROWS } from '~/archive/query'
import type {
  ArchiveDocument,
  Category,
  DocumentPage,
  LibrarySearch,
  SortOrder,
  ViewMode,
  YearFilter,
} from '~/archive/types'
import { Icon, type IconName } from '~/components/Icon'
import { cs, fill } from '~/copy/cs'
import { CategoryPills } from './CategoryPills'
import { ListView, PreviewView } from './DocumentViews'

/** How long the search waits after the last key before it asks the server. */
const SEARCH_DELAY_MS = 250

const VIEWS: readonly { mode: ViewMode; label: string; icon: IconName }[] = [
  { mode: 'seznam', label: cs.library.viewList, icon: 'list' },
  { mode: 'nahled', label: cs.library.viewPreview, icon: 'preview' },
]

interface LibraryProps {
  /** The page of matching documents the server returned for `search`. */
  result: DocumentPage
  categories: readonly Category[]
  search: LibrarySearch
  onSearchChange: (patch: Partial<LibrarySearch>) => void
  /** Adds a document to those the chat answers from, or takes it out again. */
  onAskAbout: (document: ArchiveDocument) => void
  /** The documents the chat answers from now. */
  chosenIds: readonly string[]
}

export function Library({
  result,
  categories,
  search,
  onSearchChange,
  onAskAbout,
  chosenIds,
}: Readonly<LibraryProps>) {
  const view = search.zobrazeni ?? 'seznam'
  const startingOrder = libraryOrder(search.q)
  const order = search.razeni ?? startingOrder
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const archiveIsEmpty = result.archiveTotal === 0
  const filtered = hasActiveFilters(search)

  // What is typed is shown at once; the address, and with it the search on the
  // server, follows when the typing stops.
  const [typed, setTyped] = useState(search.q ?? '')
  const sent = useRef(search.q)
  const waiting = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    // The address changed from elsewhere, e.g. a removed filter chip.
    if (search.q !== sent.current) {
      sent.current = search.q
      setTyped(search.q ?? '')
    }
  }, [search.q])
  useEffect(() => () => clearTimeout(waiting.current), [])

  function type(value: string) {
    setTyped(value)
    clearTimeout(waiting.current)
    waiting.current = setTimeout(() => {
      const q = value.trim() === '' ? undefined : value
      sent.current = q
      // A new search starts with the best match first.
      onSearchChange({ q, razeni: undefined, pocet: undefined })
    }, SEARCH_DELAY_MS)
  }

  /** Any change of what is listed starts again with the first documents. */
  function change(patch: Partial<LibrarySearch>) {
    onSearchChange({ pocet: undefined, ...patch })
  }

  function changeOrder(razeni: SortOrder) {
    change({ razeni: razeni === startingOrder ? undefined : razeni })
  }

  function clearAll() {
    clearTimeout(waiting.current)
    change({
      q: undefined,
      kategorie: undefined,
      rok: undefined,
      typ: undefined,
      razeni: undefined,
    })
  }

  const viewProps = { documents: result.documents, categories: categoryById, query: search.q }
  const shown = result.documents.length

  // The list grows by itself: when the end of it scrolls into view, the next
  // documents are asked for. The button under the list stays for when that does not happen.
  const listEnd = useRef<HTMLDivElement>(null)
  /** The list more was asked for last, so one look at its end asks only once. */
  const askedFor = useRef<DocumentPage | null>(null)
  const canShowMore = shown < result.total && shown < MAX_LIST_ROWS
  const nextCount = Math.min(shown + LIST_STEP, MAX_LIST_ROWS)
  useEffect(() => {
    const end = listEnd.current
    if (end === null || !canShowMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || askedFor.current === result) return
        askedFor.current = result
        onSearchChange({ pocet: nextCount })
      },
      // A little before the end shows, so the reader does not wait at the bottom.
      { rootMargin: '0px 0px 300px 0px' },
    )
    observer.observe(end)
    return () => observer.disconnect()
  }, [canShowMore, nextCount, onSearchChange, result])
  const allCount = Object.values(result.categoryCounts).reduce((sum, count) => sum + count, 0)
  const pills = [
    { id: undefined, name: cs.library.allCategories, count: allCount },
    ...categories.map((category) => ({
      id: category.id,
      name: category.name,
      count: result.categoryCounts[category.id] ?? 0,
    })),
  ]

  return (
    <div className="lib">
      <div className="lib__top">
        <label className="lib-search">
          <Icon name="search" size={18} />
          <span className="visually-hidden">{cs.library.searchLabel}</span>
          <input
            type="search"
            value={typed}
            placeholder={cs.library.searchPlaceholder}
            onChange={(event) => type(event.target.value)}
          />
        </label>
        <div className="view-switch" role="radiogroup" aria-label={cs.library.viewLabel}>
          {VIEWS.map((item) => (
            <button
              key={item.mode}
              type="button"
              role="radio"
              aria-checked={view === item.mode}
              aria-label={item.label}
              data-tip={item.label}
              className="view-switch__option"
              onClick={() =>
                onSearchChange({ zobrazeni: item.mode === 'seznam' ? undefined : item.mode })
              }
            >
              <Icon name={item.icon} size={18} />
            </button>
          ))}
        </div>
      </div>

      <div className="lib__filters">
        <CategoryPills
          pills={pills}
          chosenId={search.kategorie}
          onChoose={(id) => change({ kategorie: id })}
        />
        <div className="lib__selects">
          <label className="pill-select">
            <span aria-hidden="true">{cs.library.yearShort}</span>
            <select
              aria-label={cs.library.yearLabel}
              value={search.rok === undefined ? '' : String(search.rok)}
              onChange={(event) => change({ rok: parseYear(event.target.value) })}
            >
              <option value="">{cs.library.allYears}</option>
              {result.years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
              <option value="neznamy">{cs.library.unknownYear}</option>
            </select>
          </label>
          <label className="pill-select">
            <select
              aria-label={cs.library.sortLabel}
              value={order}
              onChange={(event) => changeOrder(event.target.value as SortOrder)}
            >
              {startingOrder === 'shoda' ? (
                <option value="shoda">{cs.library.sortRelevance}</option>
              ) : null}
              <option value="vydane">{cs.library.sortNewest}</option>
              <option value="vydane-z">{cs.library.sortOldest}</option>
              <option value="nove">{cs.library.sortAdded}</option>
              <option value="nazev">{cs.library.sortTitle}</option>
              <option value="nazev-z">{cs.library.sortTitleReverse}</option>
              <option value="kategorie">{cs.library.sortCategory}</option>
              <option value="kategorie-z">{cs.library.sortCategoryReverse}</option>
            </select>
          </label>
        </div>
      </div>

      <div className={view === 'seznam' ? 'lib-card' : 'lib-card lib-card--open'}>
        {archiveIsEmpty ? (
          <div className="notice" role="status">
            <h2>{cs.library.emptyArchiveTitle}</h2>
            <p>{cs.library.emptyArchiveText}</p>
          </div>
        ) : result.total === 0 ? (
          <div className="notice" role="status">
            <h2>{cs.library.noResultsTitle}</h2>
            <p>{cs.library.noResultsText}</p>
            {filtered ? (
              <button type="button" className="button" onClick={clearAll}>
                {cs.library.clearFilters}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {view === 'seznam' ? (
              <ListView
                {...viewProps}
                order={order}
                onAskAbout={onAskAbout}
                chosenIds={chosenIds}
              />
            ) : null}
            {view === 'nahled' ? <PreviewView {...viewProps} /> : null}

            <div className="lib-card__foot">
              <p role="status">
                {fill(cs.library.shownCount, {
                  shown,
                  total: plural(result.total, 'dokumentu', 'dokumentů', 'dokumentů'),
                })}
              </p>
              {canShowMore ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => onSearchChange({ pocet: nextCount })}
                >
                  {cs.library.showMore}
                </button>
              ) : null}
            </div>
            <div ref={listEnd} aria-hidden="true" />
          </>
        )}
      </div>
    </div>
  )
}

function parseYear(value: string): YearFilter | undefined {
  if (value === '') return undefined
  if (value === 'neznamy') return 'neznamy'
  return Number(value)
}
