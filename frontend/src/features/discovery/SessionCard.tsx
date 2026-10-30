import { Link } from 'react-router'
import { forumPath } from '../forum/room.ts'
import type { LectureModule, LectureSession } from './types.ts'

type SessionCardProps = {
  session: LectureSession
  module: LectureModule | undefined
  acadYear: string
  semester: number
}

function SessionCard({
  session,
  module,
  acadYear,
  semester,
}: SessionCardProps) {
  const venue = session.online
    ? 'Online'
    : // Venues such as LT11 do not name their building; COM1-0207 does.
      session.building && !session.venue.startsWith(session.building)
      ? `${session.venue} · ${session.building}`
      : session.venue

  return (
    <article className="session-card">
      <div className="session-time">
        {session.startTime}–{session.endTime}
      </div>
      <div className="session-body">
        <h3>
          <span className="session-code">{session.moduleCode}</span>{' '}
          {session.moduleTitle}
        </h3>
        <p className="session-meta">
          <span>{venue}</span>
          <span>Capacity {session.size}</span>
          <span>{session.faculty}</span>
          {session.level !== null && <span>Level {session.level}</span>}
          {session.crossListed.length > 0 && (
            <span>Also {session.crossListed.join(', ')}</span>
          )}
        </p>
        <details className="session-details">
          <summary>About this module</summary>
          <p>{module?.description || 'No description available.'}</p>
          <p className="session-meta">
            <span>{session.department}</span>
            {module?.moduleCredit && <span>{module.moduleCredit} units</span>}
            <span>Lecture group {session.classNo}</span>
          </p>
          <a
            href={`https://nusmods.com/courses/${encodeURIComponent(session.moduleCode)}`}
            target="_blank"
            rel="noreferrer"
          >
            View on NUSMods
          </a>
        </details>
        <Link
          className="session-forum-link"
          to={forumPath(session.id, acadYear, semester)}
        >
          Join discussion
        </Link>
      </div>
    </article>
  )
}

export default SessionCard
