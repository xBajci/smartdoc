import { createFileRoute } from '@tanstack/react-router'
import { MAX_FILE_BYTES } from '~/archive/upload'
import { isAdmin } from '~/server/session'
import { getStorage, originalKey } from '~/server/storage'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The length the sender declared, or null when it gave none that can be used. */
function declaredLength(request: Request) {
  const header = request.headers.get('content-length')
  return header !== null && /^\d+$/.test(header) ? Number(header) : null
}

/** Hosts are compared, not whole addresses: behind the proxy this application is asked over http. */
function sameHost(origin: string, request: Request) {
  return URL.canParse(origin) && new URL(origin).host === new URL(request.url).host
}

/**
 * Receives one file from the administrator's browser and hands it to file
 * storage as it arrives. The record is made afterwards by `createDocumentFn`,
 * which checks the stored file again.
 */
export const Route = createFileRoute('/api/upload/$id')({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        if (!isAdmin()) return new Response('Unauthorized', { status: 401 })
        // A page of another site must not be able to post a file with the administrator's cookie.
        const origin = request.headers.get('origin')
        if (origin !== null && !sameHost(origin, request)) {
          return new Response('Forbidden', { status: 403 })
        }
        if (!UUID.test(params.id) || request.body === null) {
          return new Response('Bad request', { status: 400 })
        }
        const result = await getStorage().writeStream(originalKey(params.id), request.body, {
          length: declaredLength(request),
          maxBytes: MAX_FILE_BYTES,
        })
        return new Response(null, { status: result === 'ok' ? 204 : 413 })
      },
    },
  },
})
