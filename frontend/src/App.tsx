import { Link, NavLink, Outlet } from 'react-router'

function App() {
  return (
    <>
      <header className="app-header">
        <Link to="/" className="app-brand">
          LectureKaki
        </Link>
        <nav className="app-nav" aria-label="Main">
          <NavLink to="/" end>
            Discover
          </NavLink>
          <NavLink to="/timetable">My Timetable</NavLink>
          <NavLink to="/forum">Forum</NavLink>
        </nav>
        <nav className="app-nav app-nav-account" aria-label="Account">
          <NavLink to="/profile">Profile</NavLink>
        </nav>
      </header>
      <Outlet />
    </>
  )
}

export default App
