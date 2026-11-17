// Lets a command run by tsx import a text file the way Vite does: `import text from './x.md?raw'`.
// Use: tsx --import ./scripts/raw-loader.mjs <command>
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.endsWith('?raw')) return nextResolve(specifier, context)
    const resolved = nextResolve(specifier.slice(0, -'?raw'.length), context)
    return { ...resolved, url: `${resolved.url}?raw`, shortCircuit: true }
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('?raw')) return nextLoad(url, context)
    const text = readFileSync(fileURLToPath(url.slice(0, -'?raw'.length)), 'utf8')
    return {
      format: 'module',
      source: `export default ${JSON.stringify(text)}`,
      shortCircuit: true,
    }
  },
})
