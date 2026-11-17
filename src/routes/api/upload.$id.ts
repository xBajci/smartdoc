import { createFileRoute } from '@tanstack/react-router'
import { MAX_FILE_BYTES } from '~/archive/upload'
import { storageMode } from '~/server/config'
import { isAdmin } from '~/server/session'
import { localOriginalKey, writeLocalStream } from '~/server/storage'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Receives one file when storage is a local folder (development and tests).
 * On Vercel the browser sends files straight to blob storage instead, because
 * a function there accepts a request body of 4.5 MB at most.
 */
export const Route = createFileRoute('/api/upload/$id')({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        if (storageMode() !== 'local') return new Response('Not found', { status: 404 })
        if (!isAdmin()) return new Response('Unauthorized', { status: 401 })
        // A page of another site must not be able to post a file with the administrator's cookie.
        const origin = request.headers.get('origin')
        if (origin !== null && origin !== new URL(request.url).origin) {
          return new Response('Forbidden', { status: 403 })
        }
        if (!UUID.test(params.id) || request.body === null) {
          return new Response('Bad request', { status: 400 })
        }
        const result = await writeLocalStream(
          localOriginalKey(params.id),
          request.body,
          MAX_FILE_BYTES,
        )
        return new Response(null, { status: result === 'ok' ? 204 : 413 })
      },
    },
  },
})
