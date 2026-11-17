import { createFileRoute } from '@tanstack/react-router'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { MAX_FILE_BYTES } from '~/archive/upload'
import { storageMode } from '~/server/config'
import { isAdmin } from '~/server/session'

const PATHNAME = /^documents\/[0-9a-f-]{36}\/[^/]+$/

/**
 * Hands the administrator's browser a short-lived permission to write one
 * file straight to blob storage. The record is made afterwards by
 * `createDocumentFn`, which checks the stored file again.
 */
export const Route = createFileRoute('/api/upload-blob')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (storageMode() !== 'blob') return new Response('Not found', { status: 404 })
        const body = (await request.json()) as HandleUploadBody
        try {
          const result = await handleUpload({
            request,
            body,
            onBeforeGenerateToken: async (pathname) => {
              if (!isAdmin()) throw new Error('Unauthorized')
              if (!PATHNAME.test(pathname)) throw new Error('Invalid pathname')
              return {
                allowedContentTypes: ['application/pdf', 'image/png', 'image/jpeg'],
                maximumSizeInBytes: MAX_FILE_BYTES,
                addRandomSuffix: true,
              }
            },
          })
          return Response.json(result)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Upload refused'
          return Response.json({ error: message }, { status: 400 })
        }
      },
    },
  },
})
