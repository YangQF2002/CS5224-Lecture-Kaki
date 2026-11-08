import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import SelectField from '../../SelectField.tsx'
import Icon from '../../Icon.tsx'
// prettier-ignore
import { chooseDefaultWeek, singaporeNow, weekName } from '../discovery/discoveryFilters.ts'
// prettier-ignore
import { fetchLectureSnapshot, fetchWeekSessions } from '../discovery/lectureApi.ts'
import type { LectureSnapshot, WeekSessions } from '../discovery/types.ts'
import { getRemoteTimetable } from '../timetable/timetableApi.ts'
import { loadTimetable } from '../timetable/timetableStorage.ts'
import type { Semester, TimetableBook } from '../timetable/types.ts'
import { getAccessToken } from './auth.ts'
// prettier-ignore
import { lectureDate, lectureTime, parseRoomId, roomIdFor, roomPath } from './roomCatalogue.ts'
import { lastForumPath, lastRoom, rememberPicker } from './roomSession.ts'
import ForumLayout from './ForumLayout.tsx'
import './forum.css'
const PAGE_SIZE = 30

function LecturePicker() {
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    rememberPicker(params)
  }, [params])
  const [snapshot, setSnapshot] = useState<LectureSnapshot | null>(null)
  const [snapshotError, setSnapshotError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [weekData, setWeekData] = useState<{
    path: string
    data: WeekSessions
  } | null>(null)
  const [weekError, setWeekError] = useState('')
  const [shown, setShown] = useState({ key: '', count: PAGE_SIZE })
  const [timetable] = useState(loadTimetable)
  const [accountTimetable, setAccountTimetable] =
    useState<TimetableBook | null>(null)
  const query = params.get('q') ?? ''
  const selectedWeek =
    snapshot?.index.weeks.find((week) => week.week === params.get('week')) ??
    snapshot?.index.weeks.find(
      (week) =>
        week.week ===
        chooseDefaultWeek(snapshot.index.weeks, singaporeNow().date),
    )

  useEffect(() => {
    let cancelled = false
    fetchLectureSnapshot().then(
      (result) => {
        if (!cancelled) {
          setSnapshot(result)
          setSnapshotError(false)
        }
      },
      () => {
        if (!cancelled) setSnapshotError(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [retry])

  useEffect(() => {
    if (!snapshot || !selectedWeek) return
    let cancelled = false
    const week = selectedWeek.week
    fetchWeekSessions(snapshot.pointer, week).then(
      (result) => {
        if (!cancelled) {
          setWeekData({ path: snapshot.pointer.path, data: result })
          setWeekError('')
        }
      },
      () => {
        if (!cancelled) setWeekError(`${snapshot.pointer.path}:${week}`)
      },
    )
    return () => {
      cancelled = true
    }
  }, [snapshot, selectedWeek, retry])

  // Signed-in users: use the timetable saved to their account, which this
  // browser may not have yet (e.g. a new device). Signed-out users, or any
  // failure, keep the copy saved in this browser.
  useEffect(() => {
    let cancelled = false
    getRemoteTimetable(getAccessToken).then(
      (book) => {
        if (!cancelled) setAccountTimetable(book)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [])

  function update(name: string, value: string) {
    const next = new URLSearchParams(params)
    next.set('browse', '1')
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }

  // Modules in the user's timetable for the term the lecture list covers.
  const timetableCodes = useMemo(() => {
    if (!snapshot) return new Set<string>()
    const { acadYear } = snapshot.pointer
    const semester = snapshot.pointer.semester as Semester
    let selections =
      accountTimetable?.academicYear === acadYear
        ? (accountTimetable.semesters[semester] ?? [])
        : null
    if (!selections && timetable.academicYear === acadYear) {
      selections =
        semester === timetable.semester
          ? timetable.selections
          : (timetable.semesterSelections?.[semester] ?? [])
    }
    return new Set(selections?.map((selection) => selection.moduleCode))
  }, [snapshot, timetable, accountTimetable])

  const sessions = useMemo(() => {
    if (
      !snapshot ||
      weekData?.path !== snapshot.pointer.path ||
      weekData.data.week !== selectedWeek?.week
    )
      return null
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return weekData.data.sessions
      .filter((session) => {
        const text =
          `${session.moduleCode} ${session.moduleTitle} ${session.venue}`.toLowerCase()
        return (
          words.every((word) => text.includes(word)) &&
          !!parseRoomId(roomIdFor(session, snapshot.pointer))
        )
      })
      .sort(
        // Timetable modules first, then by date and start time.
        (a, b) =>
          Number(timetableCodes.has(b.moduleCode)) -
            Number(timetableCodes.has(a.moduleCode)) ||
          a.date.localeCompare(b.date) ||
          a.startTime.localeCompare(b.startTime) ||
          a.moduleCode.localeCompare(b.moduleCode),
      )
  }, [snapshot, weekData, selectedWeek, query, timetableCodes])
  const resultKey = `${selectedWeek?.week}:${query}`
  const visible = shown.key === resultKey ? shown.count : PAGE_SIZE
  const previous = lastRoom()
  const failed =
    snapshotError ||
    (!sessions &&
      weekError === `${snapshot?.pointer.path}:${selectedWeek?.week}`)

  return (
    <ForumLayout>
      <header className="page-heading">
        <p className="eyebrow">Better with a kaki</p>
        <h1>Lecture Forum</h1>
        <p>
          New lecture, familiar faces. Choose a lecture to find your kaki.
          Messages disappear after 24 hours.
        </p>
        {snapshot && (
          <p className="forum-term">
            Academic year {snapshot.pointer.acadYear} · Semester{' '}
            {snapshot.pointer.semester}
          </p>
        )}
      </header>
      {previous && (
        <p>
          <Link to={roomPath(previous)}>Return to your last discussion</Link>
        </p>
      )}
      <section className="panel forum-filters" aria-label="Find a discussion">
        <label htmlFor="forum-search">
          Find a lecture
          <input
            id="forum-search"
            type="search"
            value={query}
            onChange={(event) => update('q', event.target.value)}
            placeholder="Module code, title or venue"
          />
        </label>
        <label htmlFor="forum-week">
          Week
          <SelectField
            value={selectedWeek?.week ?? 'none'}
            onValueChange={(value) => update('week', value)}
            disabled={!snapshot?.index.weeks.length}
            aria-label="Week"
            options={
              snapshot?.index.weeks.length
                ? snapshot.index.weeks.map((week) => ({
                    value: week.week,
                    label: `${weekName(week.week)} · ${lectureDate(week.startDate)}`,
                  }))
                : [{ value: 'none', label: 'No weeks available' }]
            }
          >
            {/*
                {weekName(week.week)} · {lectureDate(week.startDate)}
          */}
          </SelectField>
        </label>
      </section>
      {failed ? (
        <p role="alert" className="status-message">
          We couldn’t load the lecture list.{' '}
          <button
            className="secondary"
            onClick={() => {
              setSnapshotError(false)
              setWeekError('')
              setRetry((value) => value + 1)
            }}
          >
            Retry
          </button>
        </p>
      ) : !snapshot || (!sessions && selectedWeek) ? (
        <p role="status">Loading lectures…</p>
      ) : !selectedWeek ? (
        <p>No lectures are available for this term.</p>
      ) : sessions?.length === 0 ? (
        <p>
          No lectures match this search in {weekName(selectedWeek.week)}. Try
          another week or search.
        </p>
      ) : (
        <>
          <p role="status">
            {sessions?.length} {sessions?.length === 1 ? 'lecture' : 'lectures'}{' '}
            in {weekName(selectedWeek.week)}
          </p>
          <div className="forum-lecture-list">
            {sessions?.slice(0, visible).map((session) => (
              <article className="panel forum-lecture" key={session.id}>
                <span className="forum-lecture-icon" aria-hidden="true">
                  <Icon name="message" />
                </span>
                <div className="forum-lecture-copy">
                  <h2>
                    {session.moduleCode} <span>{session.moduleTitle}</span>
                  </h2>
                  <p>
                    {lectureDate(session.date)} ·{' '}
                    {lectureTime(session.startTime)}–
                    {lectureTime(session.endTime)} · {session.venue}
                  </p>
                  {timetableCodes.has(session.moduleCode) && (
                    <p className="forum-in-timetable">
                      <Icon name="check" />
                      In your timetable
                    </p>
                  )}
                </div>
                <Link
                  className="forum-join button-link secondary"
                  to={roomPath(roomIdFor(session, snapshot!.pointer))}
                  aria-label={`Join ${session.moduleCode} discussion on ${lectureDate(session.date)} at ${lectureTime(session.startTime)}`}
                >
                  Join discussion <Icon name="arrow" />
                </Link>
              </article>
            ))}
          </div>
          {sessions && sessions.length > visible && (
            <button
              className="secondary"
              onClick={() =>
                setShown({ key: resultKey, count: visible + PAGE_SIZE })
              }
            >
              Show more lectures
            </button>
          )}
        </>
      )}
    </ForumLayout>
  )
}

export default function ForumHome() {
  const [params] = useSearchParams()
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [])
  if (params.get('browse') !== '1') {
    return <Navigate to={lastForumPath() ?? '/forum?browse=1'} replace />
  }
  return <LecturePicker />
}
