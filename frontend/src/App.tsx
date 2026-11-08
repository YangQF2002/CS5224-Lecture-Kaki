import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import Icon, { type IconName } from './Icon.tsx'
import AccountMenu from './features/profile/AccountMenu.tsx'
import SidebarTopics from './features/profile/SidebarTopics.tsx'

const navigation: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Discover', icon: 'compass' },
  { to: '/timetable', label: 'My Timetable', icon: 'calendar' },
  { to: '/forum', label: 'Forum', icon: 'message' },
  { to: '/profile', label: 'Profile', icon: 'user' },
]

const SIDEBAR_HIDDEN_KEY = 'lecturekaki:sidebar-hidden'

function readSidebarHidden() {
  try {
    return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function App() {
  const { pathname } = useLocation()
  const [sidebarHidden, setSidebarHidden] = useState(readSidebarHidden)
  function toggleSidebar() {
    const next = !sidebarHidden
    setSidebarHidden(next)
    try {
      localStorage.setItem(SIDEBAR_HIDDEN_KEY, next ? '1' : '0')
    } catch {
      // Storage can be unavailable (e.g. private mode); the toggle still works.
    }
  }
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  const currentPage =
    navigation.find(({ to }) =>
      to === '/' ? pathname === '/' : pathname.startsWith(to),
    )?.label ?? 'Your account'

  return (
    <div className={`app-layout${sidebarHidden ? ' is-sidebar-hidden' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside id="app-sidebar" className="app-sidebar">
        <Link to="/" className="app-brand" aria-label="LectureKaki home">
          <span className="brand-mark" aria-hidden="true">
            k
          </span>
          <span>
            LectureKaki<span className="brand-dot">.</span>
          </span>
        </Link>
        <p className="brand-caption">For curious minds at NUS</p>
        <nav className="app-nav" aria-label="Main">
          {navigation.map(({ to, label, icon }) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon name={icon} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-explore">
          <p className="eyebrow">Follow your curiosity</p>
          <SidebarTopics />
        </div>
        <div className="sidebar-bottom">
          <AccountMenu key={pathname} />
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-start">
            <button
              type="button"
              className="sidebar-toggle"
              aria-controls="app-sidebar"
              aria-expanded={!sidebarHidden}
              aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
              title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
              onClick={toggleSidebar}
            >
              <Icon name="menu" />
            </button>
            <div className="app-breadcrumb">
              <span>Your campus</span>
              <span aria-hidden="true">/</span>
              <strong>{currentPage}</strong>
            </div>
          </div>
          <span className="campus-label">
            <span />
            National University of Singapore
          </span>
        </header>
        <div id="main-content" tabIndex={-1}>
          <Outlet />
        </div>
        <footer className="app-footer">
          <span>For curious minds, across campus.</span>
          <span>LectureKaki · NUS</span>
        </footer>
      </div>
    </div>
  )
}

export default App
