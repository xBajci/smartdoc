import { BUILD_ID, VERSION_URL } from './version'

/**
 * Loads the page again when it failed, so a visitor sees the page and not an
 * error. A tab that stayed open over a deploy is the usual cause: it asks the
 * new server for files and server functions of the old build. This is the one
 * place that knows when a page may load itself again.
 */

const RELOADED_AT = 'archiv:reloaded-at'
/** A failure this soon after a reload is not cured by another reload; the page says so instead. */
export const QUIET_AFTER_RELOAD_MS = 30_000

type Clock = () => number

/** What `reloadOnce` reaches for in the browser; a test gives its own. */
export interface Tab {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  reload: () => void
  now: Clock
}

function thisTab(): Tab | null {
  try {
    return {
      storage: window.sessionStorage,
      reload: () => window.location.reload(),
      now: Date.now,
    }
  } catch {
    // Without storage nothing remembers the last reload, and the page could reload forever.
    return null
  }
}

/**
 * Loads the page again, unless it did so for a failure a moment ago. Returns
 * whether it reloads; `false` means the failure stays and must be shown.
 */
export function reloadOnce(tab: Tab | null = thisTab()): boolean {
  if (tab === null) return false
  try {
    const last = Number(tab.storage.getItem(RELOADED_AT) ?? 0)
    if (tab.now() - last < QUIET_AFTER_RELOAD_MS) return false
    tab.storage.setItem(RELOADED_AT, String(tab.now()))
  } catch {
    return false
  }
  tab.reload()
  return true
}

/** Whether the server runs another build than this tab. A server that does not answer says nothing. */
export async function isStale(ask: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await ask(VERSION_URL, { cache: 'no-store' })
    if (!response.ok) return false
    const running: unknown = await response.json()
    return (
      typeof running === 'object' &&
      running !== null &&
      'id' in running &&
      typeof running.id === 'string' &&
      running.id !== BUILD_ID
    )
  } catch {
    return false
  }
}

/** Loads the page again when the server was deployed since the tab was loaded. Returns whether it reloads. */
export async function reloadIfStale(): Promise<boolean> {
  return (await isStale()) && reloadOnce()
}

/** The page is on its way out: a call that waits on this never ends, so no error is shown before it goes. */
const leaving = () => new Promise<never>(() => {})

/**
 * The `fetch` of every call of a server function in the browser
 * (`src/start.ts`). A call that fails in a tab loaded before a deploy is not
 * the visitor's concern: the tab loads itself again. A failure of the running
 * build is passed on.
 *
 * A server that does not know the function answers 500 with a body the
 * framework would hand to the caller as if it were the function's result.
 * Such an answer is made an error here, so the caller fails where it called.
 */
export const serverFunctionFetch: typeof fetch = async (input, init) => {
  let response: Response
  try {
    response = await fetch(input, init)
  } catch (error) {
    // The caller gave the call up itself; nothing failed.
    if (init?.signal?.aborted === true) throw error
    if (await reloadIfStale()) return leaving()
    throw error
  }
  if (response.ok) return response
  if (await reloadIfStale()) return leaving()
  // An error the function itself threw comes serialized, and the framework throws it at the caller.
  if (response.status < 500 || response.headers.has('x-tss-serialized')) return response
  throw new Error(`The server did not run the server function: ${response.status}.`)
}

let watching = false

/**
 * A file of the old build that the new server no longer has: Vite tells the
 * page with this event. The page loads again and gets the files of the new build.
 */
export function reloadOnMissingFile() {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('vite:preloadError', (event) => {
    // Handled here; otherwise the failed import would also be thrown at the page.
    if (reloadOnce()) event.preventDefault()
  })
}
