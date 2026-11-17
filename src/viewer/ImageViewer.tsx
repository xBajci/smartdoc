import { useRef, useState } from 'react'
import { Icon } from '~/components/Icon'
import { cs } from '~/copy/cs'

const MIN_SCALE = 0.1
const MAX_SCALE = 6
const ZOOM_STEP = 1.25

interface ImageViewerProps {
  url: string
  title: string
  onError: () => void
}

export function ImageViewer({ url, title, onError }: Readonly<ImageViewerProps>) {
  const scroller = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [naturalWidth, setNaturalWidth] = useState(0)

  /** Scale the image is drawn at right now, also while it is fitted to the window. */
  function currentScale() {
    const element = image.current
    const box = scroller.current
    if (zoom !== 'fit') return zoom
    if (element === null || box === null || element.naturalWidth === 0) return 1
    return Math.min(
      box.clientWidth / element.naturalWidth,
      box.clientHeight / element.naturalHeight,
    )
  }

  function changeZoom(factor: number) {
    setZoom(Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentScale() * factor)))
  }

  const shownPercent = zoom === 'fit' ? null : Math.round(zoom * 100)

  return (
    <>
      <div className="viewer-tools" role="toolbar" aria-label={cs.viewer.toolbar}>
        <div className="viewer-tools__group">
          <button
            type="button"
            className="tool-button"
            onClick={() => changeZoom(1 / ZOOM_STEP)}
            aria-label={cs.viewer.zoomOut}
            title={cs.viewer.zoomOut}
          >
            <Icon name="minus" />
          </button>
          {shownPercent === null ? null : <output className="zoom-value">{shownPercent} %</output>}
          <button
            type="button"
            className="tool-button"
            onClick={() => changeZoom(ZOOM_STEP)}
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
            {cs.viewer.fitWindow}
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className={
          zoom === 'fit'
            ? 'viewer-canvas image-stage image-stage--fit'
            : 'viewer-canvas image-stage'
        }
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard.
        tabIndex={0}
        role="group"
        aria-label={cs.viewer.imageRegion}
        onPointerDown={(event) => {
          const element = scroller.current
          if (element === null || zoom === 'fit') return
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: element.scrollLeft,
            top: element.scrollTop,
          }
          element.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const element = scroller.current
          if (element === null || drag.current === null) return
          element.scrollLeft = drag.current.left - (event.clientX - drag.current.x)
          element.scrollTop = drag.current.top - (event.clientY - drag.current.y)
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <img
          ref={image}
          src={url}
          alt={title}
          draggable={false}
          onError={onError}
          onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth)}
          style={zoom === 'fit' || naturalWidth === 0 ? undefined : { width: naturalWidth * zoom }}
        />
      </div>
    </>
  )
}
