import { createFileRoute, Link, Outlet, useLocation } from '@tanstack/react-router'
import { LoginForm } from '~/admin/LoginForm'
import { loadArchive, useArchive } from '~/archive/store'
import { AppHeader } from '~/components/AppHeader'
import { cs } from '~/copy/cs'

export const Route = createFileRoute('/sprava')({
  loader: loadArchive,
  component: AdminLayout,
})

function AdminLayout() {
  const signedIn = useArchive().isAdmin
  // The list of processing has two panels of its own; every other page is one column.
  const isList = useLocation({ select: (location) => /^\/sprava\/?$/.test(location.pathname) })

  if (!signedIn) {
    return (
      <div className="app">
        <AppHeader />
        <main className="admin admin--login">
          <LoginForm />
          <Link to="/" className="link-button">
            {cs.admin.backToLibrary}
          </Link>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <AppHeader />
      {isList ? (
        <Outlet />
      ) : (
        <main className="admin">
          <Outlet />
        </main>
      )}
    </div>
  )
}
