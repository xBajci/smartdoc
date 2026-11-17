import { useEffect, useId, useRef, useState } from 'react'
import type { ArchiveDocument } from '~/archive/types'
import { Icon } from '~/components/Icon'
import { cs } from '~/copy/cs'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'

interface DocumentOverlayProps {
  document: ArchiveDocument
  onClose: () => void
}

/**
 * A document opened over the page it was on, with the original to download.
 * The page stays where it was underneath; Escape, the close button or a click
 * beside the window returns to it.
 */
export function DocumentOverlay({ document, onClose }: Readonly<DocumentOverlayProps>) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (!dialog.open) dialog.showModal()
    return () => dialog.close()
  }, [])

  const downloadAddress = `${document.fileUrl}?stahnout`

  return (
    // The dialog itself is the dimmed area around the window; a click there closes it.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Escape and the close button do the same for the keyboard
    <dialog
      ref={ref}
      className="image-overlay"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="image-overlay__window viewer viewer--compact">
        <div className="viewer-bar">
          <div className="viewer-bar__heading">
            <div className="viewer-bar__names">
              <h2 id={titleId} className="viewer-bar__title">
                {document.title}
              </h2>
              <p className="document-filename">{document.originalFilename}</p>
            </div>
          </div>
          <div className="viewer-bar__actions">
            <a
              className="icon-button"
              href={downloadAddress}
              download={document.originalFilename}
              aria-label={cs.viewer.download}
              data-tip={cs.viewer.download}
            >
              <Icon name="download" size={20} />
            </a>
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label={cs.viewer.close}
              data-tip={cs.viewer.close}
            >
              <Icon name="close" size={20} />
            </button>
          </div>
        </div>
        {failed ? (
          <div className="notice" role="alert">
            <h2>{cs.viewer.renderErrorTitle}</h2>
            <p>{cs.viewer.renderErrorText}</p>
            <a className="button" href={downloadAddress} download={document.originalFilename}>
              <Icon name="download" />
              {cs.viewer.download}
            </a>
          </div>
        ) : document.format === 'pdf' ? (
          <PdfViewer
            url={document.fileUrl}
            initialPage={1}
            onPageChange={() => undefined}
            onError={() => setFailed(true)}
          />
        ) : (
          <ImageViewer
            url={document.fileUrl}
            title={document.title}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </dialog>
  )
}
