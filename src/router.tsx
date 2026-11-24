import { createRouter } from '@tanstack/react-router'
import { PageFailed } from './components/PageFailed'
import { reloadOnMissingFile } from './reload'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  reloadOnMissingFile()
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Every route without an error page of its own: a failed page loads itself again.
    defaultErrorComponent: PageFailed,
  })
}
