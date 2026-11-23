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
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart({
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
