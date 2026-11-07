import { Link } from 'react-router'
import Icon from '../../Icon.tsx'
import type { TimetableLesson } from '../timetable/types.ts'
import type { TimetableCheck } from './timetableClashes.ts'
import type { LectureModule, LectureSession } from './types.ts'

type SessionCardProps = {
  session: LectureSession
  module: LectureModule | undefined
  addedToTimetable: boolean
  disableAdd: boolean
  clashes?: TimetableLesson[]
  timetableCheck: TimetableCheck
  discussionPath: string | null
  onAddToTimetable: () => void
}

function hhmm(time: string): string {
  return `${time.slice(0, 2)}:${time.slice(2)}`
}

function moduleColour(moduleCode: string) {
  const colours = ['sage', 'clay', 'lavender', 'sand'] as const
  // A stable code-based hash keeps every lecture of a module the same colour.
  let hash = 0
  for (const character of moduleCode.trim().toUpperCase()) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0
  }
  return colours[hash % colours.length]
}

export default function SessionCard({
  session,
  module,
  addedToTimetable,
  disableAdd,
  clashes = [],
  timetableCheck,
  discussionPath,
  onAddToTimetable,
}: SessionCardProps) {
  const venue = session.online
    ? 'Online'
    : session.building && !session.venue.startsWith(session.building)
      ? `${session.venue} · ${session.building}`
      : session.venue
  const colour = moduleColour(session.moduleCode)
  const clashDescription = [
    ...new Set(
      clashes.map(
        (lesson) =>
          `${lesson.moduleCode} ${lesson.lessonType} ${hhmm(lesson.startTime)}–${hhmm(lesson.endTime)}`,
      ),
    ),
  ].join(', ')

  return (
    <article
      className={`session-card${clashes.length > 0 ? ' has-clash' : ''}`}
    >
      <div className={`session-cover cover-${colour}`} aria-hidden="true">
        <span className="cover-code">
          {session.moduleCode} / {session.faculty}
        </span>
      </div>
      <div className="session-body">
        <h3>
          <span className="visually-hidden">{session.moduleCode} </span>
          {session.moduleTitle}
        </h3>
        <p className="session-time">
          <Icon name="clock" />
          <span>
            {session.startTime}–{session.endTime}
          </span>
        </p>
        <p className="session-venue">
          <Icon name="pin" />
          <span>{venue}</span>
        </p>
        <div className="session-availability">
          {clashes.length > 0 ? (
            <details className="session-clash">
              <summary>
                <Icon name="alert" />
                Clashes with your timetable
              </summary>
              <p>{clashDescription}</p>
            </details>
          ) : addedToTimetable ? (
            <span className="session-fit">
              <Icon name="check" />
              In your timetable
            </span>
          ) : timetableCheck === 'ready' ? (
            <span className="session-fit">
              <Icon name="check" />
              Fits your timetable
            </span>
          ) : timetableCheck === 'loading' ? (
            <span className="session-checking">Checking your timetable…</span>
          ) : timetableCheck === 'unavailable' ? (
            <span className="session-checking">
              Timetable check unavailable
            </span>
          ) : null}
        </div>
        {module?.topics && module.topics.length > 0 && (
          <ul className="session-topics" aria-label="Topics">
            {module.topics.slice(0, 2).map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        )}
        <details className="session-details">
          <summary>About this module</summary>
          <p>{module?.description || 'No description available.'}</p>
          <p className="session-meta">
            <span>{session.faculty}</span>
            <span>{session.department}</span>
            <span>Capacity {session.size}</span>
            {session.level !== null && <span>Level {session.level}</span>}
            {module?.moduleCredit && <span>{module.moduleCredit} units</span>}
            <span>Lecture group {session.classNo}</span>
            {session.crossListed.length > 0 && (
              <span>Also {session.crossListed.join(', ')}</span>
            )}
          </p>
          {module?.topics && module.topics.length > 2 && (
            <p className="session-meta">Topics: {module.topics.join(', ')}</p>
          )}
          <a
            href={`https://nusmods.com/courses/${encodeURIComponent(session.moduleCode)}`}
            target="_blank"
            rel="noreferrer"
          >
            View on NUSMods <Icon name="arrow" />
          </a>
        </details>
        <div className="session-actions">
          {discussionPath && (
            <Link
              to={discussionPath}
              className="session-discussion"
              aria-label={`Discuss ${session.moduleCode} on ${session.date} at ${session.startTime}`}
            >
              <Icon name="message" />
              Discuss
            </Link>
          )}
          {session.lessonType === 'Lecture' && (
            <button
              type="button"
              className={`add-to-timetable${addedToTimetable ? ' is-added' : ''}`}
              aria-pressed={addedToTimetable}
              aria-label={`${addedToTimetable ? 'Remove' : 'Add'} ${session.moduleCode} ${addedToTimetable ? 'from' : 'to'} timetable`}
              disabled={disableAdd}
              title={
                disableAdd
                  ? 'Manage enrolled lectures in My Timetable'
                  : undefined
              }
              onClick={onAddToTimetable}
            >
              <Icon name={addedToTimetable ? 'check' : 'plus'} />
              {addedToTimetable ? 'Added' : 'Add to timetable'}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
