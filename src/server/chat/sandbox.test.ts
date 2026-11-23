import { describe, expect, it } from 'vitest'
import { parametersAsJson, runInSandbox } from './sandbox'

// The sandbox is a security boundary, and no E2E test can reach it with a script
// of its own choosing: the model writes the scripts. So its walls are tested here.
describe('runInSandbox', () => {
  const run = (script: string, parameters: unknown) =>
    runInSandbox(script, parametersAsJson(parameters) ?? '{}')

  it('runs the script with the parameters and returns the value as JSON', async () => {
    const script = 'return parametry.castky.reduce((sum, castka) => sum + castka, 0)'
    expect(await run(script, { castky: [870000, 240000] })).toEqual({
      result: '1110000',
      error: null,
    })
    expect(await run('return { prumer: 3 / 2 }', {})).toEqual({
      result: '{"prumer":1.5}',
      error: null,
    })
  })

  it('reports a syntax error and an error at run time', async () => {
    expect((await run('return (1 +', {})).error).toMatch(/^SyntaxError: /)
    expect((await run('return parametry.chybi.delka', {})).error).toMatch(/^TypeError: /)
    expect((await run('throw "nic"', {})).error).toBe('Skript vyhodil hodnotu "nic".')
  })

  it('says when the script returns nothing', async () => {
    expect((await run('const soucet = 1 + 1', {})).error).toBe(
      'Skript nic nevrátil. Výsledek vrať příkazem return.',
    )
  })

  it('has no network, no files and no Node', async () => {
    for (const name of ['require', 'process', 'fetch', 'XMLHttpRequest', 'Deno', 'Bun']) {
      expect(await run(`return typeof ${name}`, {})).toEqual({ result: '"undefined"', error: null })
    }
    // A dynamic import gives a promise, and the sandbox never runs what waits on one.
    const script = 'let nacteno = false; import("fs").then(() => (nacteno = true)); return nacteno'
    expect(await run(script, {})).toEqual({ result: 'false', error: null })
  })

  it('stops a script that runs too long', async () => {
    expect((await run('while (true) {}', {})).error).toBe(
      'Skript běžel déle než 1 s a byl zastaven.',
    )
  })

  it('stops a script that takes too much memory, also in large arrays QuickJS does not count', async () => {
    for (const script of [
      'const kusy = []; while (true) kusy.push("x".repeat(1000000) + kusy.length); return 1',
      'const kusy = []; while (true) kusy.push(new Array(100000).fill(1)); return 1',
      'const kusy = []; while (true) kusy.push(new Float64Array(1000000)); return 1',
    ]) {
      const started = Date.now()
      expect((await run(script, {})).error).toBe(
        'Skript potřeboval příliš mnoho paměti a byl zastaven.',
      )
      expect(Date.now() - started).toBeLessThan(1000)
    }
  })

  it('stops a recursion that never ends', async () => {
    expect((await run('const f = () => f(); return f()', {})).error).toMatch(/stack overflow/)
  })

  it('starts every run clean, so one script cannot leave anything for the next', async () => {
    expect((await run('globalThis.zbytek = 42; return 1', {})).result).toBe('1')
    expect((await run('return typeof zbytek', {})).result).toBe('"undefined"')
  })

  it('keeps working after a script broke its engine', async () => {
    await run('const f = () => f(); return f()', {})
    expect((await run('return 2 + 2', {})).result).toBe('4')
  })

  it('stops a script whose slow built-in calls outrun the limit of QuickJS, and the server keeps going', async () => {
    let ticks = 0
    const clock = setInterval(() => (ticks += 1), 50)
    const started = Date.now()
    const outcome = await run('const b = 3n ** 100000n; for (;;) String(b)', {})
    clearInterval(clock)
    expect(outcome.error).toBe('Skript běžel déle než 1 s a byl zastaven.')
    expect(Date.now() - started).toBeLessThan(2500)
    // The main thread was free the whole time.
    expect(ticks).toBeGreaterThan(15)
    expect((await run('return 2 + 2', {})).result).toBe('4')
  })

  it('cuts a long error short, so a script cannot fill the input of the model', async () => {
    const outcome = await run('throw new Error("ab ".repeat(2500000))', {})
    expect(outcome.error?.length).toBeLessThan(1100)
    expect(outcome.error).toMatch(/chyba je zkrácená\)$/)
  })

  it('refuses parameters nested too deep to turn into JSON', () => {
    const deep = JSON.parse(`${'{"a":'.repeat(100_000)}1${'}'.repeat(100_000)}`) as unknown
    expect(parametersAsJson(deep)).toBeNull()
  })

  it('fails a run whose parameters overflow the stack of QuickJS, and the next run works', async () => {
    const deep = `${'{"a":'.repeat(100_000)}1${'}'.repeat(100_000)}`
    expect((await runInSandbox('return 1', deep)).error).not.toBeNull()
    expect((await run('return 2', {})).result).toBe('2')
  })
})
