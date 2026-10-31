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
          <NavLink to="/timetable">My timetable</NavLink>
          <NavLink to="/forum">Forum</NavLink>
        </nav>
      </header>
      <Outlet />
    </>
  )
}

export default App
