import { createFileRoute } from '@tanstack/react-router'
import { buildFeed } from '~/server/feed'

export const Route = createFileRoute('/rss.xml')({
  server: {
    handlers: {
      GET: async ({ request }) =>
        new Response(await buildFeed(new URL(request.url).origin), {
          headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            // A reader may keep its copy for a few minutes; a new document is not urgent news.
            'Cache-Control': 'public, max-age=300',
          },
        }),
    },
  },
})
