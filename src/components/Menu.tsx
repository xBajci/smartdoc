import { useEffect, useRef, type ReactNode } from 'react'

interface MenuProps {
  /** What the button of the menu shows. */
  summary: ReactNode
  /** Name of the menu for a screen reader, when the summary alone does not say it. */
  label?: string
  className?: string
  /** Which edge of the button the list lines up with. */
  align?: 'start' | 'end'
  children: ReactNode
}

/**
 * A small list that drops from a button. It closes on a choice, on a click
 * elsewhere and on Escape.
 */
export function Menu({
  summary,
  label,
  className,
  align = 'start',
  children,
}: Readonly<MenuProps>) {
  const menu = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const close = () => {
      if (menu.current !== null) menu.current.open = false
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && menu.current?.contains(event.target) !== true) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    // A choice in the list closes it; the choice itself is handled by the item.
    const chosen = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.menu__item, .menu__option') !== null
      )
        close()
    }
    const element = menu.current
    element?.addEventListener('click', chosen)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      element?.removeEventListener('click', chosen)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  return (
    <details ref={menu} className={className === undefined ? 'menu' : `menu ${className}`}>
      <summary className="menu__button" aria-label={label}>
        {summary}
      </summary>
      <div className={`menu__list menu__list--${align}`}>{children}</div>
    </details>
  )
}
