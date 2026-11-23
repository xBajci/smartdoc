import type { MessagePort } from 'node:worker_threads'
import type * as QuickJs from 'quickjs-emscripten-core'
import type { ScriptRun } from './sandbox'

/** What the main thread hands the worker; the limits travel with it, so nothing is imported. */
export interface SandboxWorkerSetup {
  /** The URLs of `quickjs-emscripten-core` and of the QuickJS variant to load. */
  core: string
  variant: string
  timeMs: number
  memoryBytes: number
  /** All the memory the engine may ever have, in WebAssembly pages of 64 KiB. */
  enginePages: number
  stackBytes: number
  maxResultCharacters: number
}

export interface SandboxRequest {
  id: number
  script: string
  /** The parameters as JSON; the main thread made the text, so it is known to work. */
  parametersJson: string
}

export interface SandboxReply {
  id: number
  run: ScriptRun
}

/**
 * The body of the sandbox worker. It does not run here: `sandbox.ts` turns it
 * into source text and starts it in a worker thread, because the bundle of the
 * server has no file of its own to start a worker from. So it may use only what
 * it is given and the language itself, never a name from around it.
 *
 * QuickJS is a JavaScript engine compiled to WebAssembly. Inside there is only
 * the language: no network, no files, no `require`, no `process`. The engine is
 * loaded once per worker; every run gets a runtime of its own. A run that broke
 * the engine (a recursion that never ends) loads a new one for the next run.
 */
export function sandboxWorker(given: {
  load: (url: string) => Promise<unknown>
  port: MessagePort
  setup: SandboxWorkerSetup
}): void {
  const { load, port, setup } = given
  const core = load(setup.core) as Promise<typeof QuickJs>
  const variant = load(setup.variant) as Promise<{ default: QuickJs.QuickJSSyncVariant }>
  // The memory limit of QuickJS misses some allocations (large arrays), so the
  // engine also gets memory of a fixed size; past it, QuickJS runs out of memory.
  const loadEngine = async () => {
    const quickJs = await core
    const module = await quickJs.newQuickJSWASMModuleFromVariant(
      quickJs.newVariant((await variant).default, {
        wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: setup.enginePages }),
      }),
    )
    return { quickJs, module }
  }
  let engine = loadEngine()

  const failed = (error: string): ScriptRun => ({ result: null, error })

  /** What the script threw, in words the model can fix the script by. */
  function describe(thrown: unknown): string {
    if (typeof thrown !== 'object' || thrown === null || !('message' in thrown)) {
      return `Skript vyhodil hodnotu ${JSON.stringify(thrown)}.`
    }
    const { name, message } = thrown as { name?: unknown; message: unknown }
    if (name === 'InternalError' && message === 'interrupted') {
      return `Skript běžel déle než ${setup.timeMs / 1000} s a byl zastaven.`
    }
    if (name === 'InternalError' && message === 'out of memory') {
      return 'Skript potřeboval příliš mnoho paměti a byl zastaven.'
    }
    return `${typeof name === 'string' ? name : 'Error'}: ${String(message)}`
  }

  function run(
    { quickJs, module }: Awaited<ReturnType<typeof loadEngine>>,
    script: string,
    parametersJson: string,
  ): ScriptRun {
    const runtime = module.newRuntime()
    runtime.setMemoryLimit(setup.memoryBytes)
    runtime.setMaxStackSize(setup.stackBytes)
    // Checked only now and then; a slow built-in call can outlast it, so the main thread keeps a limit of its own.
    runtime.setInterruptHandler(quickJs.shouldInterruptAfterDeadline(Date.now() + setup.timeMs))
    const context = runtime.newContext()
    try {
      // The script is the body of a function. Its value leaves the sandbox as JSON, so only data comes out.
      const code = [
        '"use strict";',
        `const parametry = JSON.parse(${JSON.stringify(parametersJson)});`,
        'JSON.stringify((function (parametry) {',
        script,
        '})(parametry));',
      ].join('\n')
      const evaluated = context.evalCode(code, 'skript.js', { type: 'global' })
      if (evaluated.error !== undefined) {
        const thrown: unknown = context.dump(evaluated.error)
        evaluated.error.dispose()
        return failed(describe(thrown))
      }
      const value: unknown = context.dump(evaluated.value)
      evaluated.value.dispose()
      if (typeof value !== 'string') {
        return failed('Skript nic nevrátil. Výsledek vrať příkazem return.')
      }
      if (value.length > setup.maxResultCharacters) {
        return failed(
          `Výsledek má víc než ${setup.maxResultCharacters} znaků. Vrať jen to, co potřebuješ.`,
        )
      }
      return { result: value, error: null }
    } finally {
      try {
        context.dispose()
        runtime.dispose()
      } catch {
        // A stack overflow leaves objects QuickJS cannot free; the next run gets a new engine.
        engine = loadEngine()
      }
    }
  }

  async function answer({ id, script, parametersJson }: SandboxRequest): Promise<SandboxReply> {
    try {
      return { id, run: run(await engine, script, parametersJson) }
    } catch (caught) {
      engine = loadEngine()
      return { id, run: failed(`Výpočet se nepodařilo dokončit: ${String(caught)}`) }
    }
  }

  port.on('message', (request: SandboxRequest) => {
    void answer(request).then((reply) => port.postMessage(reply))
  })
}
