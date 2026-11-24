import { createFileRoute } from '@tanstack/react-router'
import { BUILD_ID } from '~/version'

/**
 * Says which build the server runs. A tab that was loaded before a deploy
 * asks here when something fails, and loads itself again when the answer is
 * not its own build (see `src/reload.ts`).
 */
export const Route = createFileRoute('/api/verze')({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { id: BUILD_ID },
          // Always the running server's answer, never one a cache kept from before a deploy.
          { headers: { 'Cache-Control': 'no-store' } },
        ),
    },
  },
})
