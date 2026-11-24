import { describe, expect, it } from 'vitest'
import { isStale, QUIET_AFTER_RELOAD_MS, reloadOnce, type Tab } from './reload'
import { BUILD_ID } from './version'

/** A tab with its own storage and clock, that counts how often it was loaded again. */
function tab(at = 1_000_000) {
  const kept = new Map<string, string>()
  const state = { now: at, reloads: 0 }
  const fake: Tab = {
    storage: {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => void kept.set(key, value),
    },
    reload: () => {
      state.reloads += 1
    },
    now: () => state.now,
  }
  return { fake, state }
}

describe('a page that failed', () => {
  it('loads itself again', () => {
    const { fake, state } = tab()
    expect(reloadOnce(fake)).toBe(true)
    expect(state.reloads).toBe(1)
  })

  it('does not load itself again when it fails right after that', () => {
    const { fake, state } = tab()
    reloadOnce(fake)
    state.now += QUIET_AFTER_RELOAD_MS - 1
    expect(reloadOnce(fake)).toBe(false)
    expect(state.reloads).toBe(1)
  })

  it('loads itself again for a failure that comes later', () => {
    const { fake, state } = tab()
    reloadOnce(fake)
    state.now += QUIET_AFTER_RELOAD_MS
    expect(reloadOnce(fake)).toBe(true)
    expect(state.reloads).toBe(2)
  })

  it('stays as it is when nothing can remember the last reload', () => {
    const { fake, state } = tab()
    const forgetful: Tab = {
      ...fake,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('Storage is full.')
        },
      },
    }
    expect(reloadOnce(forgetful)).toBe(false)
    expect(reloadOnce(null)).toBe(false)
    expect(state.reloads).toBe(0)
  })
})

describe('a tab that asks which build the server runs', () => {
  const answering = (body: unknown, status = 200): typeof fetch =>
    (() => Promise.resolve(Response.json(body, { status }))) as typeof fetch

  it('is stale when the server runs another build', async () => {
    expect(await isStale(answering({ id: 'another-build' }))).toBe(true)
  })

  it('is not stale when the server runs its own build', async () => {
    expect(await isStale(answering({ id: BUILD_ID }))).toBe(false)
  })

  it('takes no answer, a failed answer and a strange answer for no news', async () => {
    const silent = (() => Promise.reject(new Error('offline'))) as typeof fetch
    expect(await isStale(silent)).toBe(false)
    expect(await isStale(answering({ id: 'another-build' }, 503))).toBe(false)
    expect(await isStale(answering({ build: 7 }))).toBe(false)
    expect(await isStale(answering(null))).toBe(false)
  })
})
