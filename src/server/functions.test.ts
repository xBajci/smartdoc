import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Every server function is the administrator's unless it is named here. A
// function open to visitors is a decision, so adding one means adding its name.
const OPEN_TO_VISITORS = [
  'getArchiveFn',
  'searchLibraryFn',
  'getDocumentsFn',
  'signInFn',
  'signOutFn',
  'askArchiveFn',
  'rateChatFn',
]

const FILES = [
  './archive-functions.ts',
  './processing-functions.ts',
  './ai/functions.ts',
  './chat/functions.ts',
]

/** Every server function of a file with its source, from its `export` to the next one. */
function serverFunctions(file: string): { name: string; source: string }[] {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8')
  return text
    .split(/^(?=export const \w+ = createServerFn\()/m)
    .slice(1)
    .map((source) => ({ name: /^export const (\w+)/.exec(source)?.[1] ?? '', source }))
}

describe('server functions', () => {
  const functions = FILES.flatMap(serverFunctions)

  it('finds every server function of every file', () => {
    expect(functions.length).toBeGreaterThan(20)
    for (const file of FILES) {
      // A function written another way, e.g. not exported, would hide behind its neighbour.
      const made = readFileSync(new URL(file, import.meta.url), 'utf8').split('createServerFn(')
      expect(serverFunctions(file)).toHaveLength(made.length - 1)
    }
  })

  it('refuses a visitor in every function that is not open to visitors', () => {
    const unguarded = functions
      .filter(({ source }) => !/\.handler\(\s*(forAdmin|adminOrNull)\(/.test(source))
      .map(({ name }) => name)
    expect([...unguarded].sort()).toEqual([...OPEN_TO_VISITORS].sort())
  })

  it('keeps server functions in the files this test reads', () => {
    // A server function written elsewhere would escape the check above.
    const source = new URL('../', import.meta.url)
    const withFunctions = readdirSync(source, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'))
      .filter((file) => readFileSync(new URL(file, source), 'utf8').includes('createServerFn'))
    expect(withFunctions.sort()).toEqual(FILES.map((file) => `server/${file.slice(2)}`).sort())
  })
})
