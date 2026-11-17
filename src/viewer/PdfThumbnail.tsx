import { useEffect, useRef, useState } from 'react'
import { Icon } from '~/components/Icon'
import { loadPdfJs } from './pdfjs'

const THUMBNAIL_WIDTH = 520

/** First page of a PDF, drawn only once the card scrolls into view. */
export function PdfThumbnail({ url, label }: Readonly<{ url: string; label: string }>) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'waiting' | 'drawn' | 'failed'>('waiting')

  useEffect(() => {
    const target = canvas.current
    if (target === null) return
    let cancelled = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void (async () => {
          try {
            const pdfjs = await loadPdfJs()
            const document = await pdfjs.getDocument({ url }).promise
            const page = await document.getPage(1)
            const base = page.getViewport({ scale: 1 })
            const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / base.width })
            if (cancelled) return
            target.width = Math.floor(viewport.width)
            target.height = Math.floor(viewport.height)
            await page.render({ canvas: target, viewport }).promise
            void document.loadingTask.destroy()
            if (!cancelled) setState('drawn')
          } catch {
            if (!cancelled) setState('failed')
          }
        })()
      },
      { rootMargin: '300px' },
    )
    observer.observe(target)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [url])

  return (
    <>
      <canvas ref={canvas} role="img" aria-label={label} hidden={state === 'failed'} />
      {state === 'failed' ? <Icon name="pdf" size={40} /> : null}
    </>
  )
}
