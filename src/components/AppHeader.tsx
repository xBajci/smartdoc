import { Link, useLocation } from '@tanstack/react-router'
import { archive, useArchive } from '~/archive/store'
import { cs } from '~/copy/cs'
import { Icon } from './Icon'
import { Menu } from './Menu'

/** Pages of the administration that the "Správa" menu leads to. */
const ADMIN_PAGES = [
  { to: '/sprava/kategorie', label: cs.admin.navCategories, icon: 'tag' },
  { to: '/sprava/skilly', label: cs.admin.navSkills, icon: 'edit' },
  { to: '/sprava/naklady', label: cs.admin.navCosts, icon: 'info' },
  { to: '/sprava/chat', label: cs.admin.navChat, icon: 'chat' },
] as const

/** "Správce archivu" → "SA" */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
}

/**
 * The one header of the application. A visitor sees the library only; the
 * administrator also gets the way to uploading, processing and the settings.
 */
export function AppHeader() {
  const { isAdmin } = useArchive()
  const path = useLocation({ select: (location) => location.pathname })
  const inAdminPage = ADMIN_PAGES.some((page) => path.startsWith(page.to))

  return (
    <header className="app-header">
      <Link to="/" className="brand" aria-label={cs.brand.home}>
        <span className="brand__mark" aria-hidden="true">
          {cs.brand.product.charAt(0)}
        </span>
        <span className="brand__text">
          <span className="brand__name">
            <span className="brand__product">{cs.brand.product}</span> {cs.brand.place}
          </span>
          <span className="brand__tagline">{cs.brand.tagline}</span>
        </span>
      </Link>

      <nav className="main-nav" aria-label={cs.nav.label}>
        <Link to="/" className="main-nav__link" activeOptions={{ includeSearch: false }}>
          {cs.nav.documents}
        </Link>
        {isAdmin ? (
          <>
            {/* Uploading has no page of its own: it is a window over the list of processing. */}
            <Link
              to="/sprava"
              className="main-nav__link"
              activeOptions={{ exact: true, includeSearch: false }}
            >
              {cs.nav.processing}
            </Link>
            <Menu
              className={inAdminPage ? 'main-nav__menu main-nav__menu--current' : 'main-nav__menu'}
              summary={
                <>
                  {cs.nav.admin}
                  <Icon name="down" size={16} />
                </>
              }
            >
              {ADMIN_PAGES.map((page) => (
                <Link key={page.to} to={page.to} className="menu__item">
                  <Icon name={page.icon} size={19} />
                  {page.label}
                </Link>
              ))}
            </Menu>
          </>
        ) : null}
      </nav>

      <div className="app-header__aside">
        {/* A plain link, not a route: the feed is a file for a reader's program. */}
        <a
          className="feed-link"
          href="/rss.xml"
          aria-label={cs.feed.title}
          data-tip={cs.feed.title}
        >
          <Icon name="rss" size={18} />
        </a>
        <Menu
          className="account"
          align="end"
          label={cs.nav.account}
          summary={
            <>
              <span className="account__avatar" aria-hidden="true">
                {initials(isAdmin ? cs.nav.adminName : cs.nav.visitorName)}
              </span>
              <span className="account__who">
                <strong>{isAdmin ? cs.nav.adminName : cs.nav.visitorName}</strong>
                <span className={isAdmin ? 'account__role account__role--admin' : 'account__role'}>
                  {isAdmin ? cs.nav.adminRole : cs.nav.visitorRole}
                </span>
              </span>
            </>
          }
        >
          {isAdmin ? (
            <button type="button" className="menu__item" onClick={() => void archive.signOut()}>
              <Icon name="signOut" size={19} />
              {cs.admin.signOut}
            </button>
          ) : (
            <Link to="/prihlaseni" className="menu__item">
              <Icon name="lock" size={19} />
              {cs.nav.signIn}
            </Link>
          )}
        </Menu>
      </div>
    </header>
  )
}
