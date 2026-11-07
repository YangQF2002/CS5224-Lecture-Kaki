import type { TimetableLesson } from '../timetable/types.ts'
import type { LectureModule, LectureSession } from './types.ts'

type SessionCardProps = {
  session: LectureSession
  module: LectureModule | undefined
  addedToTimetable: boolean
  disableAdd: boolean
  // Lessons in the user's timetable that overlap this session.
  clashes?: TimetableLesson[]
  onAddToTimetable: () => void
}

// NUSMods lesson times are HHMM.
function hhmm(time: string): string {
  return `${time.slice(0, 2)}:${time.slice(2)}`
}

function describeClashes(clashes: TimetableLesson[]): string {
  const labels = clashes.map(
    (lesson) =>
      `${lesson.moduleCode} ${lesson.lessonType} ${hhmm(lesson.startTime)}–${hhmm(lesson.endTime)}`,
  )
  return [...new Set(labels)].join(', ')
}

function SessionCard({
  session,
  module,
  addedToTimetable,
  disableAdd,
  clashes = [],
  onAddToTimetable,
}: SessionCardProps) {
  const venue = session.online
    ? 'Online'
    : // Venues such as LT11 do not name their building; COM1-0207 does.
      session.building && !session.venue.startsWith(session.building)
      ? `${session.venue} · ${session.building}`
      : session.venue

  return (
    <article
      className={`session-card${clashes.length > 0 ? ' has-clash' : ''}`}
    >
      <div className="session-time">
        {session.startTime}–{session.endTime}
      </div>
      <div className="session-body">
        <h3>
          <span className="session-code">{session.moduleCode}</span>{' '}
          {session.moduleTitle}
        </h3>
        {clashes.length > 0 && (
          <p className="session-clash">
            <span className="clash-tag">Clashes</span>
            <span>with your timetable: {describeClashes(clashes)}</span>
          </p>
        )}
        {module?.topics && module.topics.length > 0 && (
          <ul className="session-topics" aria-label="Topics">
            {module.topics.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        )}
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
        {session.lessonType === 'Lecture' && (
          <div className="session-actions">
            <button
              type="button"
              className="add-to-timetable"
              disabled={disableAdd}
              onClick={onAddToTimetable}
            >
              {addedToTimetable ? 'Added' : 'Add to timetable'}
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

export default SessionCard
