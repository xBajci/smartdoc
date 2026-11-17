import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '~/components/Icon'
import { cs, fill } from '~/copy/cs'
import { loadPdfJs } from './pdfjs'

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const ZOOM_STEP = 1.25
/** Horizontal room left around a page that is fitted to the panel width. */
const FIT_GUTTER = 32
/** On a wide panel a fitted page stops growing here, so text keeps a readable size. */
const FIT_MAX_SCALE = 1.5

interface PageSize {
  width: number
  height: number
}

interface PdfViewerProps {
  url: string
  initialPage: number
  onPageChange: (page: number) => void
  onError: () => void
}

export function PdfViewer({ url, initialPage, onPageChange, onError }: Readonly<PdfViewerProps>) {
  const scroller = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageSize, setPageSize] = useState<PageSize | null>(null)
  const [panelWidth, setPanelWidth] = useState(0)
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [page, setPage] = useState(initialPage)
  const [pageInput, setPageInput] = useState(String(initialPage))
  const placed = useRef(false)

  useEffect(() => {
    let cancelled = false
    let opened: PDFDocumentProxy | undefined
    void (async () => {
      try {
        const pdfjs = await loadPdfJs()
        const document = await pdfjs.getDocument({ url }).promise
        const first = await document.getPage(1)
        const viewport = first.getViewport({ scale: 1 })
        if (cancelled) {
          void document.loadingTask.destroy()
          return
        }
        opened = document
        setPageSize({ width: viewport.width, height: viewport.height })
        setPdf(document)
      } catch {
        if (!cancelled) onError()
      }
    })()
    return () => {
      cancelled = true
      void opened?.loadingTask.destroy()
    }
  }, [url, onError])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element === null) return
    setPanelWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setPanelWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitScale =
    pageSize === null || panelWidth === 0
      ? 1
      : Math.min(FIT_MAX_SCALE, Math.max(MIN_SCALE, (panelWidth - FIT_GUTTER) / pageSize.width))
  const scale = zoom === 'fit' ? fitScale : zoom
  const pageCount = pdf?.numPages ?? 0

  const goToPage = useCallback((target: number) => {
    const element = scroller.current?.querySelector<HTMLElement>(`[data-page="${target}"]`)
    const container = scroller.current
    if (element === null || element === undefined || container === null) return
    container.scrollTop = element.offsetTop - 12
  }, [])

  // Land on the requested page once the pages have their size.
  useLayoutEffect(() => {
    if (placed.current || pdf === null || pageSize === null || panelWidth === 0) return
    placed.current = true
    if (initialPage > 1) goToPage(Math.min(initialPage, pdf.numPages))
  }, [pdf, pageSize, panelWidth, initialPage, goToPage])

  function handleScroll() {
    const container = scroller.current
    if (container === null) return
    const marker = container.scrollTop + container.clientHeight / 3
    let current = 1
    for (const element of container.querySelectorAll<HTMLElement>('[data-page]')) {
      if (element.offsetTop <= marker) current = Number(element.dataset.page)
    }
    if (current !== page) {
      setPage(current)
      setPageInput(String(current))
      onPageChange(current)
    }
  }

  function changeZoom(factor: number) {
    setZoom(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor)))
  }

  function submitPage() {
    const target = Number(pageInput)
    if (Number.isInteger(target) && target >= 1 && target <= pageCount) goToPage(target)
    else setPageInput(String(page))
  }

  return (
    <>
      <div className="viewer-tools" role="toolbar" aria-label={cs.viewer.toolbar}>
        <div className="viewer-tools__group">
          <button
            type="button"
            className="tool-button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            aria-label={cs.viewer.previousPage}
            title={cs.viewer.previousPage}
          >
            <Icon name="previous" />
          </button>
          <label className="page-field">
            <span>{cs.viewer.pageLabel}</span>
            <input
              inputMode="numeric"
              aria-label={cs.viewer.pageLabel}
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={submitPage}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitPage()
              }}
              disabled={pageCount === 0}
            />
            <span>{fill(cs.viewer.pageOf, { total: pageCount === 0 ? '…' : pageCount })}</span>
          </label>
          <button
            type="button"
            className="tool-button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= pageCount}
            aria-label={cs.viewer.nextPage}
            title={cs.viewer.nextPage}
          >
            <Icon name="next" />
          </button>
        </div>
        <div className="viewer-tools__group">
          <button
            type="button"
            className="tool-button"
            onClick={() => changeZoom(1 / ZOOM_STEP)}
            disabled={scale <= MIN_SCALE}
            aria-label={cs.viewer.zoomOut}
            title={cs.viewer.zoomOut}
          >
            <Icon name="minus" />
          </button>
          <output className="zoom-value">{Math.round(scale * 100)} %</output>
          <button
            type="button"
            className="tool-button"
            onClick={() => changeZoom(ZOOM_STEP)}
            disabled={scale >= MAX_SCALE}
            aria-label={cs.viewer.zoomIn}
            title={cs.viewer.zoomIn}
          >
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className="tool-button tool-button--text"
            onClick={() => setZoom('fit')}
            aria-pressed={zoom === 'fit'}
          >
            <Icon name="fit" />
            {cs.viewer.fitWidth}
          </button>
        </div>
      </div>

      <div
        className="viewer-canvas"
        ref={scroller}
        onScroll={handleScroll}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard.
        tabIndex={0}
      >
        {pdf === null || pageSize === null ? (
          <p className="viewer-loading" role="status">
            {cs.viewer.loading}
          </p>
        ) : (
          Array.from({ length: pageCount }, (_, index) => (
            <PdfPage
              key={index + 1}
              pdf={pdf}
              number={index + 1}
              scale={scale}
              fallbackSize={pageSize}
              root={scroller}
            />
          ))
        )}
      </div>
    </>
  )
}

interface PdfPageProps {
  pdf: PDFDocumentProxy
  number: number
  scale: number
  fallbackSize: PageSize
  root: React.RefObject<HTMLDivElement | null>
}

/** One page: an empty sheet of the right size until it scrolls near the viewport. */
function PdfPage({ pdf, number, scale, fallbackSize, root }: Readonly<PdfPageProps>) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [size, setSize] = useState(fallbackSize)

  useEffect(() => {
    const element = holder.current
    if (element === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { root: root.current, rootMargin: '600px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    let task: RenderTask | undefined
    void (async () => {
      try {
        const page = await pdf.getPage(number)
        const target = canvas.current
        if (cancelled || target === null) return
        const base = page.getViewport({ scale: 1 })
        setSize({ width: base.width, height: base.height })
        const viewport = page.getViewport({ scale: scale * window.devicePixelRatio })
        target.width = Math.floor(viewport.width)
        target.height = Math.floor(viewport.height)
        task = page.render({ canvas: target, viewport })
        await task.promise
      } catch {
        // A cancelled render rejects; a page that fails to draw stays blank
        // and the download button remains available.
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [near, pdf, number, scale])

  return (
    <div
      ref={holder}
      className="pdf-page"
      data-page={number}
      style={{ width: size.width * scale, height: size.height * scale }}
    >
      <canvas ref={canvas} aria-label={fill(cs.viewer.pageCanvas, { page: number })} role="img" />
    </div>
  )
}
