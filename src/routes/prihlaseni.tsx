import { createFileRoute, Link, Navigate } from '@tanstack/react-router'
import { LoginForm } from '~/admin/LoginForm'
import { loadArchive, useArchive } from '~/archive/store'
import { AppHeader } from '~/components/AppHeader'
import { cs } from '~/copy/cs'

export const Route = createFileRoute('/prihlaseni')({
  loader: loadArchive,
  component: SignInPage,
})

function SignInPage() {
  // Signed in, now or before: the library loads with what the role may do.
  if (useArchive().isAdmin) return <Navigate to="/" />
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
