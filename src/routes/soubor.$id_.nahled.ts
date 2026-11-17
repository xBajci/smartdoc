import { createFileRoute } from '@tanstack/react-router'
import { serveThumbnail } from '~/server/file-response'

export const Route = createFileRoute('/soubor/$id_/nahled')({
  server: {
    handlers: {
      GET: ({ params }) => serveThumbnail(params.id),
    },
  },
})
