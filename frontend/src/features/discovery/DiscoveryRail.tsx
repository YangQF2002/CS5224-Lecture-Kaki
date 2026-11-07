import { Link } from 'react-router'
import Icon from '../../Icon.tsx'
import { lessonMeetsOn } from '../timetable/timetableUtils.ts'
import type { TimetableLesson } from '../timetable/types.ts'
import { teachingWeek, type TimetableCheck } from './timetableClashes.ts'

type Props = {
  days: string[]
  date: string | undefined
  week: string
  lessons: TimetableLesson[]
  timetableCheck: TimetableCheck
  onDateChange: (date: string) => void
}

function dateLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-SG', {
    ...options,
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

export default function DiscoveryRail({
  days,
  date,
  week,
  lessons,
  timetableCheck,
  onDateChange,
}: Props) {
  const agenda = date
    ? lessons
        .filter((lesson) => lessonMeetsOn(lesson, date, teachingWeek(week)))
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
    : []
  return (
    <aside className="discovery-rail" aria-label="Your timetable and community">
      <section className="agenda-panel">
        <div className="agenda-heading">
          <h2>
            {date
              ? `Your ${dateLabel(date, { weekday: 'long' })}`
              : 'Your week'}
          </h2>
          <Icon name="calendar" />
        </div>
        <p className="agenda-date">
          {date
            ? dateLabel(date, { day: 'numeric', month: 'long' })
            : 'Explore your timetable'}
        </p>
        <div className="agenda-days" aria-label="Preview a day">
          {days.map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={date === day}
              aria-label={`Show lectures on ${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}`}
              onClick={() => onDateChange(day)}
            >
              <span>{dateLabel(day, { weekday: 'narrow' })}</span>
              <strong>{dateLabel(day, { day: 'numeric' })}</strong>
            </button>
          ))}
        </div>
        {timetableCheck === 'empty' ? (
          <div className="agenda-empty">
            <Icon name="book" />
            <h3>Make room to explore.</h3>
            <p>
              Add your modules or import your NUSMods timetable to see how
              lectures fit into your day.
            </p>
          </div>
        ) : timetableCheck === 'loading' ? (
          <p className="agenda-status" role="status">
            Loading your timetable…
          </p>
        ) : (
          <>
            {timetableCheck === 'unavailable' && (
              <p className="agenda-status">
                Some lessons could not be loaded. Check your timetable before
                making plans.
              </p>
            )}
            {agenda.length > 0 ? (
              <ol className="agenda-list">
                {agenda.slice(0, 4).map((lesson, index) => (
                  <li key={`${lesson.moduleCode}-${lesson.classNo}-${index}`}>
                    <span className="agenda-time">
                      {lesson.startTime.replace(/^(..)(..)$/, '$1:$2')}–
                      {lesson.endTime.replace(/^(..)(..)$/, '$1:$2')}
                    </span>
                    <strong>{lesson.moduleCode}</strong>
                    <span>
                      {lesson.lessonType} · {lesson.venue}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              timetableCheck === 'ready' && (
                <div className="agenda-free">
                  <strong>A little room to explore</strong>
                  <span>No saved lessons on this day.</span>
                </div>
              )
            )}
            {agenda.length > 4 && (
              <p className="agenda-status">
                +{agenda.length - 4} more in your timetable
              </p>
            )}
          </>
        )}
        <Link to="/timetable" className="text-link">
          {timetableCheck === 'empty'
            ? 'Set up your timetable'
            : 'Open your timetable'}
          <Icon name="arrow" />
        </Link>
      </section>
      <section className="community-note">
        <p className="eyebrow">Better with a kaki</p>
        <div className="community-illustration" aria-hidden="true">
          <span>
            <Icon name="user" />
          </span>
          <span>
            <Icon name="user" />
          </span>
          <span>
            <Icon name="user" />
          </span>
        </div>
        <h2>
          New lecture.
          <br />
          Familiar faces.
        </h2>
        <p>Find someone to sit with before you step into the lecture hall.</p>
        <Link to="/forum?browse=1" className="text-link">
          Meet in the forum
          <Icon name="arrow" />
        </Link>
      </section>
    </aside>
  )
}
