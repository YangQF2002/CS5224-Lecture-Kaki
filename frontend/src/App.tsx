import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import Icon, { type IconName } from './Icon.tsx'
import AccountMenu from './features/profile/AccountMenu.tsx'

const navigation: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Discover', icon: 'compass' },
  { to: '/timetable', label: 'My Timetable', icon: 'calendar' },
  { to: '/forum', label: 'Forum', icon: 'message' },
  { to: '/profile', label: 'Profile', icon: 'user' },
]

function App() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  const currentPage =
    navigation.find(({ to }) =>
      to === '/' ? pathname === '/' : pathname.startsWith(to),
    )?.label ?? 'Your account'

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="app-sidebar">
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
          <Link to="/?topics=AI+%26+Machine+Learning">
            <span className="subject-dot sage" />
            AI & machine learning
          </Link>
          <Link to="/?topics=Psychology">
            <span className="subject-dot clay" />
            Psychology
          </Link>
          <Link to="/?topics=Arts+%26+Media">
            <span className="subject-dot lavender" />
            Arts & media
          </Link>
          <Link className="sidebar-interests" to="/profile">
            <Icon name="plus" />
            Choose your interests
          </Link>
        </div>
        <div className="sidebar-bottom">
          <AccountMenu key={pathname} />
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="app-breadcrumb">
            <span>Your campus</span>
            <span aria-hidden="true">/</span>
            <strong>{currentPage}</strong>
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
