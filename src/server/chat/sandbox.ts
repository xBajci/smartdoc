import { Worker } from 'node:worker_threads'
import {
  sandboxWorker,
  type SandboxReply,
  type SandboxRequest,
  type SandboxWorkerSetup,
} from './sandbox-worker'

/** How long one script may run and how much memory it may take; then it is stopped. */
export const SCRIPT_TIME_MS = 1000
export const SCRIPT_MEMORY_BYTES = 16 * 1024 * 1024
/** All the memory of the engine, the script's included: 64 MB in pages of 64 KiB. */
const ENGINE_PAGES = 1024
// Well below the stack of Node, so QuickJS stops a deep recursion before Node has to.
const SCRIPT_STACK_BYTES = 256 * 1024
/**
 * QuickJS looks at its deadline only now and then, and a slow built-in call (a
 * huge BigInt turned to text, in a loop) can run far past it. So the main thread
 * gives the worker a little longer and then stops it from outside.
 */
const WORKER_TIME_MS = 1500
/** The longest script the model may send, and the longest result it gets back. */
export const MAX_SCRIPT_CHARACTERS = 10_000
export const MAX_RESULT_CHARACTERS = 4000
/** The longest error the model is told, so a script cannot fill its input with one. */
const MAX_ERROR_CHARACTERS = 1000

/** One run of a script: its result as JSON, or what went wrong, in words for the model. */
export type ScriptRun = { result: string; error: null } | { result: null; error: string }

const failed = (error: string): ScriptRun => ({ result: null, error })
const tooLong = () => failed(`Skript běžel déle než ${SCRIPT_TIME_MS / 1000} s a byl zastaven.`)

/**
 * The worker starts from source text: the bundle of the server has no file of
 * its own to start it from. It loads QuickJS from the packages on disk, found
 * from here.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
(${sandboxWorker.toString()})({ load: (url) => import(url), port: parentPort, setup: workerData });
`

/**
 * The packages the worker loads, by name. The imports are never called: Nitro
 * puts a package beside the built server only when the server imports it, and
 * only the worker uses these. `traceDeps` in `vite.config.ts` keeps them unbundled.
 */
const QUICKJS = {
  core: ['quickjs-emscripten-core', () => import('quickjs-emscripten-core')],
  variant: [
    '@jitl/quickjs-singlefile-mjs-release-sync',
    () => import('@jitl/quickjs-singlefile-mjs-release-sync'),
  ],
} as const

function workerSetup(): SandboxWorkerSetup {
  return {
    core: import.meta.resolve(QUICKJS.core[0]),
    variant: import.meta.resolve(QUICKJS.variant[0]),
    timeMs: SCRIPT_TIME_MS,
    memoryBytes: SCRIPT_MEMORY_BYTES,
    enginePages: ENGINE_PAGES,
    stackBytes: SCRIPT_STACK_BYTES,
    maxResultCharacters: MAX_RESULT_CHARACTERS,
  }
}

let worker: Worker | undefined
let lastId = 0
/** Runs go to the worker one at a time, so the time limit of one is not spent waiting for another. */
let queue: Promise<unknown> = Promise.resolve()

/**
 * The parameters of a script as JSON, or `null` when they cannot be: nested so
 * deep that turning them to text overflows the stack. Only this text goes to the
 * worker, so copying it there can never fail.
 */
export function parametersAsJson(parameters: unknown): string | null {
  try {
    return JSON.stringify(parameters ?? {})
  } catch {
    return null
  }
}

/**
 * Runs one script of the chat model in the sandbox: QuickJS in a worker
 * thread, so even a script that outruns its own limit never holds up the server.
 */
export function runInSandbox(script: string, parametersJson: string): Promise<ScriptRun> {
  const turn = queue.then(() => runInWorker(script, parametersJson))
  // One run that failed must not fail every run queued after it.
  queue = turn.catch(() => undefined)
  return turn
}

/** Checked here as well as in the worker, so not even a broken worker can send the model more. */
function bounded(run: ScriptRun): ScriptRun {
  if (run.error !== null) {
    return run.error.length <= MAX_ERROR_CHARACTERS
      ? run
      : failed(`${run.error.slice(0, MAX_ERROR_CHARACTERS)}… (chyba je zkrácená)`)
  }
  return run.result.length <= MAX_RESULT_CHARACTERS
    ? run
    : failed(`Výsledek má víc než ${MAX_RESULT_CHARACTERS} znaků. Vrať jen to, co potřebuješ.`)
}

function runInWorker(script: string, parametersJson: string): Promise<ScriptRun> {
  worker ??= startWorker()
  const current = worker
  const id = ++lastId
  // A worker that was stopped or failed is not used again; the next run starts a new one.
  const dropWorker = () => {
    if (worker === current) worker = undefined
  }
  return new Promise((resolve) => {
    const finish = (run: ScriptRun) => {
      clearTimeout(timer)
      current.off('message', onMessage)
      current.off('error', onError)
      resolve(bounded(run))
    }
    const onMessage = (reply: SandboxReply) => {
      if (reply.id === id) finish(reply.run)
    }
    const onError = (error: Error) => {
      dropWorker()
      finish(failed(`Výpočet se nepodařilo dokončit: ${error.message}`))
    }
    const timer = setTimeout(() => {
      dropWorker()
      void current.terminate()
      finish(tooLong())
    }, WORKER_TIME_MS)
    current.on('message', onMessage)
    current.on('error', onError)
    try {
      current.postMessage({ id, script, parametersJson } satisfies SandboxRequest)
    } catch (caught) {
      finish(failed(`Výpočet se nepodařilo spustit: ${String(caught)}`))
    }
  })
}

function startWorker(): Worker {
  const started = new Worker(WORKER_SOURCE, { eval: true, workerData: workerSetup() })
  // An idle worker must not keep a command or a test run from ending.
  started.unref()
  // A worker that fails between runs is dropped; with no listener its error would end the server.
  started.on('error', () => {
    if (worker === started) worker = undefined
  })
  return started
}
