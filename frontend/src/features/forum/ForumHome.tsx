import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
// prettier-ignore
import { chooseDefaultWeek, singaporeNow, weekName } from '../discovery/discoveryFilters.ts'
// prettier-ignore
import { fetchLectureSnapshot, fetchWeekSessions } from '../discovery/lectureApi.ts'
import type { LectureSnapshot, WeekSessions } from '../discovery/types.ts'
// prettier-ignore
import { lectureDate, lectureTime, parseRoomId, roomFromLink, roomIdFor, roomPath } from './roomCatalogue.ts'
import { lastForumPath, lastRoom, rememberPicker } from './roomSession.ts'
import './forum.css'

const PAGE_SIZE = 30

function LecturePicker() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
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
  const [sharedLink, setSharedLink] = useState('')
  const [linkError, setLinkError] = useState('')
  const [shown, setShown] = useState({ key: '', count: PAGE_SIZE })
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

  function update(name: string, value: string) {
    const next = new URLSearchParams(params)
    next.set('browse', '1')
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }

  const sessions = useMemo(() => {
    if (
      !snapshot ||
      weekData?.path !== snapshot.pointer.path ||
      weekData.data.week !== selectedWeek?.week
    )
      return null
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return weekData.data.sessions.filter((session) => {
      const text =
        `${session.moduleCode} ${session.moduleTitle} ${session.venue}`.toLowerCase()
      return (
        words.every((word) => text.includes(word)) &&
        !!parseRoomId(roomIdFor(session, snapshot.pointer))
      )
    })
  }, [snapshot, weekData, selectedWeek, query])
  const resultKey = `${selectedWeek?.week}:${query}`
  const visible = shown.key === resultKey ? shown.count : PAGE_SIZE
  const previous = lastRoom()
  const failed =
    snapshotError ||
    (!sessions &&
      weekError === `${snapshot?.pointer.path}:${selectedWeek?.week}`)

  return (
    <main className="forum-page forum-browser">
      <header>
        <h1>Lecture Forum</h1>
        <p>
          Choose a lecture to join its discussion. Messages disappear after 24
          hours.
        </p>
      </header>
      {previous && (
        <p>
          <Link to={roomPath(previous)}>Return to your last discussion</Link>
        </p>
      )}
      {snapshot && (
        <p className="forum-term">
          Academic year {snapshot.pointer.acadYear} · Semester{' '}
          {snapshot.pointer.semester}
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
          <select
            id="forum-week"
            value={selectedWeek?.week ?? ''}
            onChange={(event) => update('week', event.target.value)}
            disabled={!snapshot?.index.weeks.length}
          >
            {!snapshot?.index.weeks.length && (
              <option value="">No weeks available</option>
            )}
            {snapshot?.index.weeks.map((week) => (
              <option key={week.week} value={week.week}>
                {weekName(week.week)} · {lectureDate(week.startDate)}
              </option>
            ))}
          </select>
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
                <h2>
                  {session.moduleCode} <span>{session.moduleTitle}</span>
                </h2>
                <p>
                  {lectureDate(session.date)} · {lectureTime(session.startTime)}
                  –{lectureTime(session.endTime)} · {session.venue}
                </p>
                <Link
                  className="forum-join"
                  to={roomPath(roomIdFor(session, snapshot!.pointer))}
                  aria-label={`Join ${session.moduleCode} discussion on ${lectureDate(session.date)} at ${lectureTime(session.startTime)}`}
                >
                  Join discussion
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
      <details className="panel forum-shared-link">
        <summary>Have a shared discussion link?</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const id = roomFromLink(sharedLink)
            if (!id) {
              setLinkError('Enter a valid Forum discussion link or room ID.')
              return
            }
            navigate(roomPath(id))
          }}
        >
          <label htmlFor="forum-shared-link">
            Discussion link or room ID
            <input
              id="forum-shared-link"
              value={sharedLink}
              onChange={(event) => {
                setSharedLink(event.target.value)
                setLinkError('')
              }}
              required
            />
          </label>
          <button type="submit">Open discussion</button>
          {linkError && <p role="alert">{linkError}</p>}
        </form>
      </details>
    </main>
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
