import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '~/components/Icon'
import { Menu } from '~/components/Menu'
import { cs } from '~/copy/cs'

/** The space between two pills, the same as `gap` of `.pills` in the styles. */
const GAP = 6

export interface CategoryPill {
  /** `undefined` is the pill of all categories. */
  id: string | undefined
  name: string
  count: number
}

interface CategoryPillsProps {
  pills: readonly CategoryPill[]
  /** The chosen category; `undefined` means all of them. */
  chosenId: string | undefined
  onChoose: (id: string | undefined) => void
}

/**
 * The categories in one line; one of them is chosen at a time. Those that
 * do not fit go to a menu, which is then the last item of the line.
 */
export function CategoryPills({ pills, chosenId, onChoose }: Readonly<CategoryPillsProps>) {
  const line = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  // Before the first measurement every pill is in the line.
  const [fitting, setFitting] = useState(pills.length)
  const [measured, setMeasured] = useState(false)

  useLayoutEffect(() => {
    const lineElement = line.current
    const rulerElement = ruler.current
    if (lineElement === null || rulerElement === null) return

    function measure() {
      if (lineElement === null || rulerElement === null) return
      const widths = Array.from(
        rulerElement.children,
        (child) => child.getBoundingClientRect().width,
      )
      // The ruler holds every pill and, as the last one, the button of the menu.
      const pillWidths = widths.slice(0, pills.length)
      const moreWidth = widths[pills.length] ?? 0
      const available = lineElement.clientWidth

      const fit = (reserved: number) => {
        let used = reserved
        let count = 0
        for (const width of pillWidths) {
          used += width + GAP
          if (used > available) break
          count += 1
        }
        return count
      }

      let count = fit(-GAP)
      if (count < pills.length) count = Math.max(fit(moreWidth), 1)
      setFitting(count)
      setMeasured(true)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(lineElement)
    observer.observe(rulerElement)
    return () => observer.disconnect()
  }, [pills])

  const isChosen = (pill: CategoryPill) => pill.id === chosenId

  const inLine = pills.slice(0, fitting)
  const inMenu = pills.slice(fitting)

  return (
    <div ref={line} className="pills" data-measured={measured}>
      <div className="pills__line" role="group" aria-label={cs.library.categoryLabel}>
        {inLine.map((pill) => (
          <button
            key={pill.id ?? 'all'}
            type="button"
            aria-pressed={isChosen(pill)}
            className="cat-pill"
            onClick={() => onChoose(pill.id)}
          >
            <PillText pill={pill} />
          </button>
        ))}
      </div>
      {inMenu.length === 0 ? null : (
        <Menu
          className="pills__more"
          align="end"
          label={cs.library.moreCategories}
          summary={
            // The button keeps its name, so it never changes its width; it only shows that the choice is inside.
            <span className="cat-pill" data-chosen={inMenu.some(isChosen)}>
              {cs.library.more}
              <Icon name="down" size={14} />
            </span>
          }
        >
          {inMenu.map((pill) => (
            <button
              key={pill.id ?? 'all'}
              type="button"
              className="menu__option"
              aria-pressed={isChosen(pill)}
              onClick={() => onChoose(pill.id)}
            >
              <span className="menu__check">
                {isChosen(pill) ? <Icon name="check" size={14} /> : null}
              </span>
              {pill.name}
              {pill.count === 0 ? null : <span className="cat-pill__count">{pill.count}</span>}
            </button>
          ))}
        </Menu>
      )}

      {/* Not shown: only its widths are read. */}
      <div ref={ruler} className="pills__ruler" aria-hidden="true">
        {pills.map((pill) => (
          <span key={pill.id ?? 'all'} className="cat-pill">
            <PillText pill={pill} />
          </span>
        ))}
        <span className="cat-pill">
          {cs.library.more}
          <Icon name="down" size={14} />
        </span>
      </div>
    </div>
  )
}

function PillText({ pill }: Readonly<{ pill: CategoryPill }>) {
  return (
    <>
      {pill.name}
      {pill.count === 0 ? null : <span className="cat-pill__count">{pill.count}</span>}
    </>
  )
}
