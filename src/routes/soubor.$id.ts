import { createFileRoute } from '@tanstack/react-router'
import { serveOriginal } from '~/server/file-response'

export const Route = createFileRoute('/soubor/$id')({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        serveOriginal(params.id, new URL(request.url).searchParams.has('stahnout')),
    },
  },
})
