import { useRef, useState, type CSSProperties, type HTMLAttributes } from 'react'

interface SidePanelOptions {
  /** The narrowest and the widest the side panel may be, in pixels. */
  min: number
  max: number
  /** Finds the side panel inside the workspace, to read its width before the divider was moved. */
  panel: string
  /** Name of the divider for a screen reader. */
  label: string
}

/**
 * A workspace of two panels with a divider between them: the divider sets the
 * width of the right panel, by the pointer or by the arrow keys.
 */
export function useSidePanel({ min, max, panel, label }: SidePanelOptions) {
  const workspace = useRef<HTMLElement>(null)
  /** `null` until the divider is moved; the stylesheet then decides the width. */
  const [width, setWidth] = useState<number | null>(null)
  const current = () =>
    width ?? workspace.current?.querySelector(panel)?.getBoundingClientRect().width ?? min

  function resize(to: number) {
    setWidth(Math.round(Math.min(max, Math.max(min, to))))
  }

  const style = width === null ? undefined : ({ '--chat-width': `${width}px` } as CSSProperties)
  const divider: HTMLAttributes<HTMLDivElement> = {
    className: 'workspace__divider',
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': label,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': width ?? undefined,
    tabIndex: 0,
    onPointerDown: (event) => event.currentTarget.setPointerCapture(event.pointerId),
    onPointerMove: (event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const right = workspace.current?.getBoundingClientRect().right ?? window.innerWidth
      resize(right - event.clientX)
    },
    onKeyDown: (event) => {
      if (event.key === 'ArrowLeft') resize(current() + 24)
      if (event.key === 'ArrowRight') resize(current() - 24)
    },
  }

  return { workspace, style, divider }
}
