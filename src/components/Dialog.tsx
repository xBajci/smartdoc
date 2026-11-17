import { useEffect, useId, useRef, type ReactNode } from 'react'

interface DialogProps {
  title: string
  onClose: () => void
  /** For content that needs room, e.g. a table. */
  wide?: boolean
  children: ReactNode
}

/** A modal on the native `<dialog>`: focus is trapped and Escape closes it. */
export function Dialog({ title, onClose, wide, children }: Readonly<DialogProps>) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (!dialog.open) dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog--wide' : 'dialog'}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={titleId} className="dialog__title">
        {title}
      </h2>
      {children}
    </dialog>
  )
}
