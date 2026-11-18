import { createFileRoute } from '@tanstack/react-router'
import { siteUrl } from '~/server/config'
import { buildFeed } from '~/server/feed'

export const Route = createFileRoute('/rss.xml')({
  server: {
    handlers: {
      GET: async ({ request }) =>
        // Without SITE_URL (development, tests) the feed uses the address it was asked at.
        new Response(await buildFeed(siteUrl() ?? new URL(request.url).origin), {
          headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            // A reader may keep its copy for a few minutes; a new document is not urgent news.
            'Cache-Control': 'public, max-age=300',
          },
        }),
    },
  },
})
