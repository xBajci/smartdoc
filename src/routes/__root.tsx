import { createRootRoute, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AppHeader } from '~/components/AppHeader'
import { cs } from '~/copy/cs'
import publicSans from '@fontsource-variable/public-sans/index.css?url'
import plexMono from '@fontsource/ibm-plex-mono/400.css?url'
import plexMonoMedium from '@fontsource/ibm-plex-mono/500.css?url'
import appStyles from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#ffffff' },
      { title: cs.brand.documentTitle },
    ],
    links: [
      { rel: 'stylesheet', href: publicSans },
      { rel: 'stylesheet', href: plexMono },
      { rel: 'stylesheet', href: plexMonoMedium },
      { rel: 'stylesheet', href: appStyles },
      // A reader's program finds the feed of new documents by this line.
      { rel: 'alternate', type: 'application/rss+xml', title: cs.feed.title, href: '/rss.xml' },
    ],
  }),
  shellComponent: RootDocument,
  component: Outlet,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="cs">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  return (
    <div className="app">
      <AppHeader />
      <main className="admin admin--login">
        <div className="notice">
          <h1>{cs.notFound.title}</h1>
          <Link to="/" className="button">
            {cs.notFound.action}
          </Link>
        </div>
      </main>
    </div>
  )
}
