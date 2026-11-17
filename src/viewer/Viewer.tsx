import { useCallback, useEffect, useState } from 'react'
import type { ArchiveDocument } from '~/archive/types'
import { Icon } from '~/components/Icon'
import { cs } from '~/copy/cs'
import { ImageViewer } from './ImageViewer'
import { rememberedPage, rememberPage } from './pdfjs'
import { PdfViewer } from './PdfViewer'

interface ViewerProps {
  /** `undefined` when the address names a document that is removed or not public. */
  document: ArchiveDocument | undefined
  /** Page asked for by the address; it wins over the remembered page. */
  requestedPage: number | undefined
  /** Whether the document is among those the visitor chose to ask the chat about. */
  chosen?: boolean
  /** Absent where there is no chat beside the viewer; the button is then left out. */
  onAskAbout?: (document: ArchiveDocument) => void
  onBack: () => void
}

export function Viewer({
  document,
  requestedPage,
  chosen = false,
  onAskAbout,
  onBack,
}: Readonly<ViewerProps>) {
  const [expanded, setExpanded] = useState(false)
  const [failed, setFailed] = useState(false)
  const documentId = document?.id

  useEffect(() => setFailed(false), [documentId])

  useEffect(() => {
    if (!expanded) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  const handleError = useCallback(() => setFailed(true), [])
  const ask = chosen ? cs.library.askAboutChosen : cs.library.askAbout
  const handlePageChange = useCallback(
    (page: number) => {
      if (documentId !== undefined) rememberPage(documentId, page)
    },
    [documentId],
  )

  return (
    <section
      className={
        expanded ? 'panel viewer viewer--compact viewer--expanded' : 'panel viewer viewer--compact'
      }
      aria-label={document?.title ?? cs.viewer.missingTitle}
    >
      <div className="viewer-bar">
        <div className="viewer-bar__heading">
          <button
            type="button"
            className="icon-button"
            onClick={onBack}
            aria-label={cs.viewer.back}
            data-tip={cs.viewer.back}
          >
            <Icon name="back" size={20} />
          </button>
          <div className="viewer-bar__names">
            <h1 className="viewer-bar__title">{document?.title ?? cs.viewer.missingTitle}</h1>
            {document === undefined ? null : (
              <p className="document-filename">{document.originalFilename}</p>
            )}
          </div>
        </div>
        {document === undefined ? null : (
          <div className="viewer-bar__actions">
            <a
              className="icon-button"
              href={`${document.fileUrl}?stahnout`}
              download={document.originalFilename}
              aria-label={cs.viewer.download}
              data-tip={cs.viewer.download}
            >
              <Icon name="download" size={20} />
            </a>
            {/* The same choice as in the list: it adds the document to those an answer is bound to. */}
            {onAskAbout === undefined ? null : (
              <button
                type="button"
                className="icon-button"
                onClick={() => onAskAbout(document)}
                aria-pressed={chosen}
                aria-label={ask}
                data-tip={ask}
              >
                <Icon name={chosen ? 'check' : 'arrow'} size={20} />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={() => setExpanded((value) => !value)}
              aria-pressed={expanded}
              aria-label={expanded ? cs.viewer.shrink : cs.viewer.expand}
              data-tip={expanded ? cs.viewer.shrink : cs.viewer.expand}
            >
              <Icon name={expanded ? 'shrink' : 'expand'} size={20} />
            </button>
          </div>
        )}
      </div>

      {document === undefined ? (
        <div className="notice" role="status">
          <h2>{cs.viewer.missingTitle}</h2>
          <p>{cs.viewer.missingText}</p>
        </div>
      ) : failed ? (
        <div className="notice" role="alert">
          <h2>{cs.viewer.renderErrorTitle}</h2>
          <p>{cs.viewer.renderErrorText}</p>
          <a
            className="button"
            href={`${document.fileUrl}?stahnout`}
            download={document.originalFilename}
          >
            <Icon name="download" />
            {cs.viewer.download}
          </a>
        </div>
      ) : document.format === 'pdf' ? (
        <PdfViewer
          key={document.id}
          url={document.fileUrl}
          initialPage={requestedPage ?? rememberedPage(document.id) ?? 1}
          onPageChange={handlePageChange}
          onError={handleError}
        />
      ) : (
        <ImageViewer
          key={document.id}
          url={document.fileUrl}
          title={document.title}
          onError={handleError}
        />
      )}
    </section>
  )
}
