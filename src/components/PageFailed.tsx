import { useEffect, useState } from 'react'
import { cs } from '~/copy/cs'
import { reloadOnce } from '~/reload'

/**
 * What a page shows when it failed. It shows nothing and loads itself again,
 * so the visitor sees the page and not the failure. Only when the page failed
 * again right after that does it say so, with a button to try once more.
 */
export function PageFailed() {
  const [stays, setStays] = useState(false)
  useEffect(() => {
    if (!reloadOnce()) setStays(true)
  }, [])

  if (!stays) return null
  return (
    <div className="app">
      <main className="admin admin--login">
        <div className="notice" role="alert">
          <h1>{cs.brand.loadFailed}</h1>
          <p>{cs.brand.loadFailedText}</p>
          <button type="button" className="button" onClick={() => window.location.reload()}>
            {cs.brand.reload}
          </button>
        </div>
      </main>
    </div>
  )
}
