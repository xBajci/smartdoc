import { createHash, randomUUID } from 'node:crypto'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * Development only. The Nitro dev server takes a request for an image
 * (`Sec-Fetch-Dest: image`) for a static asset and answers 404 before the
 * application sees it. Stored files are served by application routes, so for
 * those the hint is neutralised. The built server has no such shortcut.
 */
function storedFilesInDevelopment(): Plugin {
  return {
    name: 'archiv:stored-files-in-development',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith('/soubor/')) request.headers['sec-fetch-dest'] = 'empty'
        next()
      })
    },
  }
}

export default defineConfig({
  server: {
    port: 3000,
  },
  define: {
    // Names this build. The server and the browser files get the same id, so a
    // tab can tell that the server was deployed again (see `src/version.ts`).
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(randomUUID()),
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart({
      serverFns: {
        // The id of a server function follows from its name alone, not from its
        // file. A tab loaded before a deploy can then still call a function
        // that only moved to another file. The names are unique (`functions.test.ts`).
        generateFunctionId: ({ functionName }) =>
          createHash('sha256').update(functionName).digest('hex'),
      },
      importProtection: {
        client: {
          // Server-function handlers are stripped first. A remaining database,
          // storage or image import must fail the build rather than reach a browser.
          specifiers: [
            'pg',
            'pg/**',
            'drizzle-orm/node-postgres',
            'drizzle-orm/node-postgres/**',
            'sharp',
          ],
        },
      },
    }),
    storedFilesInDevelopment(),
    nitro({
      // The chat's sandbox loads QuickJS in a worker thread from disk, so it must be in the build as files.
      traceDeps: ['quickjs-emscripten-core', '@jitl/quickjs-singlefile-mjs-release-sync'],
    }),
    viteReact(),
  ],
})
