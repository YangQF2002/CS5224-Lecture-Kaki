import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  DEFAULT_TO,
  OTHER_VENUES,
  buildSearchText,
  chooseDefaultWeek,
  codePrefix,
  filterSessions,
  filtersToParams,
  fromMinutes,
  parseFilters,
  singaporeNow,
  toMinutes,
  weekName,
  type DiscoveryFilters,
} from './discoveryFilters.ts'
import { fetchLectureSnapshot, fetchWeekSessions } from './lectureApi.ts'
import MultiSelect, { type MultiSelectOption } from './MultiSelect.tsx'
import SessionCard from './SessionCard.tsx'
import type { LectureSession, LectureSnapshot, WeekSessions } from './types.ts'
import './discovery.css'

const PAGE_SIZE = 50
const SOON_WINDOW_MINUTES = 180
const MIN_SIZE_OPTIONS = [0, 50, 100, 200, 400]

function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-SG', {
    ...options,
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

function formatTerm(acadYear: string, semester: number) {
  const [start, end] = acadYear.split('-')
  return `AY${start}/${end.slice(2)} Semester ${semester}`
}

function countOptions(
  sessions: LectureSession[],
  keyOf: (session: LectureSession) => string,
  selected: string[],
  labelOf: (value: string) => string = (value) => value,
): MultiSelectOption[] {
  const counts = new Map<string, number>(selected.map((value) => [value, 0]))
  for (const session of sessions) {
    const key = keyOf(session)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts]
    .map(([value, count]) => ({ value, label: labelOf(value), count }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function DiscoverPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const [queryInput, setQueryInput] = useState(filters.query)
  const [snapshot, setSnapshot] = useState<LectureSnapshot | null>(null)
  const [snapshotError, setSnapshotError] = useState('')
  const [weekData, setWeekData] = useState<WeekSessions | null>(null)
  const [weekError, setWeekError] = useState({ week: '', message: '' })
  const [today] = useState(() => singaporeNow().date)
  const [shown, setShown] = useState({ key: '', count: PAGE_SIZE })

  useEffect(() => {
    let cancelled = false

    fetchLectureSnapshot()
      .then((result) => {
        if (!cancelled) setSnapshot(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSnapshotError(
            error instanceof Error ? error.message : 'Unable to load lectures',
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const weeks = useMemo(() => snapshot?.index.weeks ?? [], [snapshot])
  const selectedWeek =
    weeks.find((week) => week.week === filters.week) ??
    weeks.find((week) => week.week === chooseDefaultWeek(weeks, today))

  useEffect(() => {
    if (!snapshot || !selectedWeek) return
    let cancelled = false
    const week = selectedWeek.week

    fetchWeekSessions(snapshot.pointer, week)
      .then((result) => {
        if (!cancelled) setWeekData(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWeekError({
            week,
            message:
              error instanceof Error
                ? error.message
                : 'Unable to load lectures',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [snapshot, selectedWeek])

  const sessions =
    weekData && weekData.week === selectedWeek?.week ? weekData.sessions : null
  const weekLoadError =
    !sessions && weekError.week === selectedWeek?.week ? weekError.message : ''

  const weekDays = useMemo(
    () =>
      selectedWeek && snapshot
        ? snapshot.index.days.filter(
            (day) =>
              selectedWeek.startDate <= day && day <= selectedWeek.endDate,
          )
        : [],
    [selectedWeek, snapshot],
  )

  const activeFilters: DiscoveryFilters = useMemo(
    () => ({
      ...filters,
      week: selectedWeek?.week ?? null,
      days: filters.days.filter((day) => weekDays.includes(day)),
    }),
    [filters, selectedWeek, weekDays],
  )

  const modulesByCode = useMemo(
    () =>
      new Map(snapshot?.modules.map((module) => [module.moduleCode, module])),
    [snapshot],
  )
  const searchText = useMemo(
    () => buildSearchText(snapshot?.modules ?? []),
    [snapshot],
  )
  const levels = useMemo(
    () =>
      [...new Set(snapshot?.modules.map((module) => module.level))]
        .filter((level): level is number => level !== null)
        .sort((a, b) => a - b),
    [snapshot],
  )

  const results = useMemo(
    () => (sessions ? filterSessions(sessions, activeFilters, searchText) : []),
    [sessions, activeFilters, searchText],
  )

  const weekSessions = useMemo(() => sessions ?? [], [sessions])
  const buildingOptions = useMemo(
    () =>
      countOptions(
        weekSessions.filter((session) => !session.online),
        (session) => session.building ?? OTHER_VENUES,
        filters.buildings,
        (value) => (value === OTHER_VENUES ? 'Other venues' : value),
      ),
    [weekSessions, filters.buildings],
  )
  const codeOptions = useMemo(
    () =>
      countOptions(
        weekSessions,
        (session) => codePrefix(session.moduleCode),
        filters.codes,
      ),
    [weekSessions, filters.codes],
  )
  const facultyOptions = useMemo(
    () =>
      countOptions(
        weekSessions,
        (session) => session.faculty,
        filters.faculties,
      ),
    [weekSessions, filters.faculties],
  )

  const resultsKey = `${searchParams.toString()}|${selectedWeek?.week}`
  const visibleCount = shown.key === resultsKey ? shown.count : PAGE_SIZE
  const visibleGroups = useMemo(() => {
    const groups = new Map<string, LectureSession[]>()
    for (const session of results.slice(0, visibleCount)) {
      const group = groups.get(session.date) ?? []
      group.push(session)
      groups.set(session.date, group)
    }
    return [...groups]
  }, [results, visibleCount])

  function updateFilters(patch: Partial<DiscoveryFilters>) {
    setSearchParams(filtersToParams({ ...filters, ...patch }), {
      replace: true,
    })
  }

  function toggleValue<T>(values: T[], value: T): T[] {
    return values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value]
  }

  const now = singaporeNow()
  const soonStart = Math.floor(now.minutes / 15) * 15
  const soonWeek = weeks.find(
    (week) => week.startDate <= now.date && now.date <= week.endDate,
  )
  const canShowSoon =
    soonWeek !== undefined &&
    snapshot?.index.days.includes(now.date) === true &&
    soonStart < toMinutes(DEFAULT_TO)

  function showStartingSoon() {
    if (!canShowSoon || !soonWeek) return
    updateFilters({
      week: soonWeek.week,
      days: [now.date],
      from: fromMinutes(soonStart),
      to: fromMinutes(
        Math.min(soonStart + SOON_WINDOW_MINUTES, toMinutes(DEFAULT_TO)),
      ),
    })
  }

  function clearFilters() {
    setQueryInput('')
    setSearchParams(
      selectedWeek ? { week: selectedWeek.week } : new URLSearchParams(),
      { replace: true },
    )
  }

  if (snapshotError) {
    return (
      <main className="discover-page">
        <h1>Discover lectures</h1>
        <p className="status-message">
          Lecture data is unavailable right now ({snapshotError}). Try again
          later.
        </p>
      </main>
    )
  }

  if (!snapshot || !selectedWeek) {
    return (
      <main className="discover-page">
        <h1>Discover lectures</h1>
        <p aria-live="polite">
          {snapshot ? 'No lectures have been published yet.' : 'Loading…'}
        </p>
      </main>
    )
  }

  return (
    <main className="discover-page">
      <header className="discover-header">
        <h1>Discover lectures</h1>
        <p>
          Find lectures outside your modules that you can drop in on.{' '}
          <span className="data-note">
            {formatTerm(snapshot.pointer.acadYear, snapshot.pointer.semester)},
            updated{' '}
            {formatDate(snapshot.pointer.generatedAt.slice(0, 10), {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </p>
      </header>

      <div className="discover-layout">
        <form
          className="panel discover-filters"
          aria-label="Lecture filters"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="filter-actions">
            <button
              type="button"
              disabled={!canShowSoon}
              title={
                canShowSoon ? undefined : 'No more lectures are scheduled today'
              }
              onClick={showStartingSoon}
            >
              Starting soon
            </button>
            <button type="button" className="secondary" onClick={clearFilters}>
              Clear filters
            </button>
          </div>

          <label>
            Keywords
            <input
              type="search"
              value={queryInput}
              placeholder="e.g. machine learning, CS2030"
              onChange={(event) => {
                setQueryInput(event.target.value)
                updateFilters({ query: event.target.value.trim() })
              }}
            />
          </label>

          <label>
            Week
            <select
              value={selectedWeek.week}
              onChange={(event) =>
                updateFilters({ week: event.target.value, days: [] })
              }
            >
              {weeks.map((week) => (
                <option key={week.week} value={week.week}>
                  {weekName(week.week)} ·{' '}
                  {formatDate(week.startDate, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>Days</legend>
            <div className="chip-row">
              {weekDays.map((day) => (
                <button
                  key={day}
                  type="button"
                  className="chip"
                  aria-pressed={activeFilters.days.includes(day)}
                  onClick={() =>
                    updateFilters({
                      days: toggleValue(activeFilters.days, day),
                    })
                  }
                >
                  {formatDate(day, {
                    weekday: 'short',
                    day: 'numeric',
                  })}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="time-range">
            <label>
              Starts from
              <input
                type="time"
                min="08:00"
                max={DEFAULT_TO}
                step={900}
                value={filters.from}
                onChange={(event) =>
                  event.target.value &&
                  updateFilters({ from: event.target.value })
                }
              />
            </label>
            <label>
              Ends by
              <input
                type="time"
                min="08:00"
                max={DEFAULT_TO}
                step={900}
                value={filters.to}
                onChange={(event) =>
                  event.target.value &&
                  updateFilters({ to: event.target.value })
                }
              />
            </label>
          </div>

          <MultiSelect
            label="Buildings"
            options={buildingOptions}
            selected={filters.buildings}
            searchPlaceholder="Search buildings"
            onChange={(buildings) => updateFilters({ buildings })}
          />
          <MultiSelect
            label="Subject codes"
            options={codeOptions}
            selected={filters.codes}
            searchPlaceholder="Search codes, e.g. CS"
            onChange={(codes) => updateFilters({ codes })}
          />
          <MultiSelect
            label="Faculties"
            options={facultyOptions}
            selected={filters.faculties}
            searchPlaceholder="Search faculties"
            onChange={(faculties) => updateFilters({ faculties })}
          />

          <fieldset>
            <legend>Levels</legend>
            <div className="chip-row">
              {levels.map((level) => (
                <button
                  key={level}
                  type="button"
                  className="chip"
                  aria-pressed={filters.levels.includes(level)}
                  onClick={() =>
                    updateFilters({
                      levels: toggleValue(filters.levels, level),
                    })
                  }
                >
                  {level}
                </button>
              ))}
            </div>
          </fieldset>

          <label>
            Minimum class size
            <select
              value={filters.minSize}
              onChange={(event) =>
                updateFilters({ minSize: Number(event.target.value) })
              }
            >
              {MIN_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size === 0 ? 'Any size' : `${size}+ students`}
                </option>
              ))}
            </select>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.includeOnline}
              onChange={(event) =>
                updateFilters({ includeOnline: event.target.checked })
              }
            />
            Include online lectures
          </label>
        </form>

        <section className="discover-results" aria-label="Lectures">
          <p className="drop-in-note">
            Lecturers may not expect visitors: arrive on time, sit at the back
            and leave if asked.
          </p>

          {weekLoadError ? (
            <p className="status-message">
              Unable to load {weekName(selectedWeek.week)} ({weekLoadError}).
            </p>
          ) : !sessions ? (
            <p aria-live="polite">Loading {weekName(selectedWeek.week)}…</p>
          ) : (
            <>
              <p className="results-count" aria-live="polite">
                {results.length === 1
                  ? '1 lecture'
                  : `${results.length.toLocaleString()} lectures`}{' '}
                in {weekName(selectedWeek.week)}
              </p>

              {results.length === 0 && (
                <p>No lectures match these filters. Try widening them.</p>
              )}

              {visibleGroups.map(([date, daySessions]) => (
                <section key={date} className="day-group">
                  <h2>
                    {formatDate(date, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </h2>
                  <div className="session-list">
                    {daySessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        module={modulesByCode.get(session.moduleCode)}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {results.length > visibleCount && (
                <button
                  type="button"
                  className="secondary show-more"
                  onClick={() =>
                    setShown({
                      key: resultsKey,
                      count: visibleCount + PAGE_SIZE,
                    })
                  }
                >
                  Show more ({(results.length - visibleCount).toLocaleString()}{' '}
                  remaining)
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}

export default DiscoverPage
