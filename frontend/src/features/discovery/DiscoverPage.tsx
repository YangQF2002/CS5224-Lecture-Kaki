import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import SelectField from '../../SelectField.tsx'
import { focusClickedField, focusNeighbour } from '../../focusNeighbour.ts'
import Icon from '../../Icon.tsx'
import DiscoveryHeader from './DiscoveryHeader.tsx'
import DiscoveryRail from './DiscoveryRail.tsx'
import { parseRoomId, roomIdFor, roomPath } from '../forum/roomCatalogue.ts'
import { SignInRequired, getAccessToken } from '../forum/auth.ts'
import { getProfile, loadLocalTopics } from '../profile/profileApi.ts'
import { fetchModule } from '../timetable/nusmodsApi.ts'
import { saveRemoteTimetable } from '../timetable/timetableApi.ts'
import { loadTimetable, saveTimetable } from '../timetable/timetableStorage.ts'
import { expandSelections } from '../timetable/timetableUtils.ts'
import {
  DEFAULT_FROM,
  DEFAULT_TO,
  OTHER_VENUES,
  buildSearchText,
  buildTopicsByCode,
  chooseDefaultWeek,
  codePrefix,
  filterSessions,
  buildRankFields,
  rankWithinDays,
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
import {
  sessionClashes,
  teachingWeek,
  type TimetableCheck,
} from './timetableClashes.ts'
import type {
  NusmodsModule,
  Semester,
  TimetableLesson,
  TimetableSelection,
  TimetableState,
} from '../timetable/types.ts'
import type { LectureSession, LectureSnapshot, WeekSessions } from './types.ts'
import './discovery.css'
const PAGE_SIZE = 24
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
  keyOf: (session: LectureSession) => string | string[],
  selected: string[],
  labelOf: (value: string) => string = (value) => value,
): MultiSelectOption[] {
  const counts = new Map<string, number>(selected.map((value) => [value, 0]))
  for (const session of sessions) {
    for (const key of [keyOf(session)].flat()) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([value, count]) => ({ value, label: labelOf(value), count }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function DiscoverPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const [searchDraft, setSearchDraft] = useState({
    query: filters.query,
    value: filters.query,
  })
  const queryInput =
    searchDraft.query === filters.query ? searchDraft.value : filters.query
  const [notice, setNotice] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<LectureSnapshot | null>(null)
  const [snapshotError, setSnapshotError] = useState('')
  const [weekData, setWeekData] = useState<WeekSessions | null>(null)
  const [weekError, setWeekError] = useState({ week: '', message: '' })
  const [today] = useState(() => singaporeNow().date)
  const [shown, setShown] = useState({ key: '', count: PAGE_SIZE })
  const [timetable, setTimetable] = useState(loadTimetable)
  // The user's interest topics: the account's when signed in, otherwise the
  // ones picked in this browser. null while loading or if unavailable.
  const [interests, setInterests] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getProfile(getAccessToken)
      .then((profile) => {
        if (!cancelled) setInterests(profile.topics)
      })
      .catch((cause: unknown) => {
        if (!cancelled && cause instanceof SignInRequired) {
          setInterests(loadLocalTopics())
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

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
  const timetableSelections = useMemo(() => {
    if (!snapshot || timetable.academicYear !== snapshot.pointer.acadYear) {
      return []
    }
    const semester = snapshot.pointer.semester as Semester
    return semester === timetable.semester
      ? timetable.selections
      : (timetable.semesterSelections?.[semester] ?? [])
  }, [snapshot, timetable])
  const nusmodsLectureCodes = useMemo(
    () =>
      new Set(
        timetableSelections
          .filter(
            (selection) =>
              selection.lessonType === 'Lecture' &&
              selection.source === undefined,
          )
          .map((selection) => selection.moduleCode),
      ),
    [timetableSelections],
  )
  const discoverLectureCodes = useMemo(
    () =>
      new Set(
        timetableSelections
          .filter(
            (selection) =>
              selection.lessonType === 'Lecture' &&
              selection.source === 'discover',
          )
          .map((selection) => selection.moduleCode),
      ),
    [timetableSelections],
  )
  // Timetable lessons with times, from NUSMods, for marking clashing lectures.
  // Kept with the selections they came from so stale results are never shown.
  const [loadedLessons, setLoadedLessons] = useState<{
    selections: TimetableSelection[]
    lessons: TimetableLesson[]
    complete: boolean
  }>({ selections: [], lessons: [], complete: false })
  const timetableLessons = useMemo(
    () =>
      loadedLessons.selections === timetableSelections
        ? loadedLessons.lessons
        : [],
    [loadedLessons, timetableSelections],
  )
  const timetableCheck: TimetableCheck =
    timetableSelections.length === 0
      ? 'empty'
      : loadedLessons.selections !== timetableSelections
        ? 'loading'
        : loadedLessons.complete
          ? 'ready'
          : 'unavailable'
  useEffect(() => {
    if (!snapshot || timetableSelections.length === 0) return
    let cancelled = false
    const academicYear = snapshot.pointer.acadYear
    const semester = snapshot.pointer.semester as Semester
    const codes = [...new Set(timetableSelections.map((s) => s.moduleCode))]

    // A module that fails to load is skipped rather than hiding every clash.
    void Promise.allSettled(
      codes.map((code) => fetchModule(academicYear, code)),
    ).then((results) => {
      if (cancelled) return
      const modules: Record<string, NusmodsModule> = {}
      for (const result of results) {
        if (result.status === 'fulfilled') {
          modules[result.value.moduleCode] = result.value
        }
      }
      setLoadedLessons({
        selections: timetableSelections,
        lessons: expandSelections(timetableSelections, modules, semester),
        complete: results.every((result) => result.status === 'fulfilled'),
      })
    })
    return () => {
      cancelled = true
    }
  }, [snapshot, timetableSelections])
  const addedLectureCodes = useMemo(
    () => new Set([...nusmodsLectureCodes, ...discoverLectureCodes]),
    [discoverLectureCodes, nusmodsLectureCodes],
  )
  const searchText = useMemo(
    () => buildSearchText(snapshot?.modules ?? []),
    [snapshot],
  )
  const rankFields = useMemo(
    () => buildRankFields(snapshot?.modules ?? []),
    [snapshot],
  )
  const topicsByCode = useMemo(
    () => buildTopicsByCode(snapshot?.modules ?? []),
    [snapshot],
  )
  const levels = useMemo(
    () =>
      [...new Set(snapshot?.modules.map((module) => module.level))]
        .filter((level): level is number => level !== null)
        .sort((a, b) => a - b),
    [snapshot],
  )

  const interestSet = useMemo(
    () => (interests?.length ? new Set(interests) : null),
    [interests],
  )

  const results = useMemo(
    () =>
      sessions
        ? rankWithinDays(
            filterSessions(
              sessions,
              activeFilters,
              searchText,
              topicsByCode,
              interestSet,
            ).filter(
              (session) =>
                !filters.hideClashes ||
                timetableCheck !== 'ready' ||
                sessionClashes(
                  session,
                  teachingWeek(selectedWeek?.week ?? ''),
                  timetableLessons,
                ).length === 0,
            ),
            activeFilters.query,
            rankFields,
          )
        : [],
    [
      sessions,
      activeFilters,
      searchText,
      rankFields,
      topicsByCode,
      interestSet,
      filters.hideClashes,
      timetableCheck,
      selectedWeek,
      timetableLessons,
    ],
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
  const topicOptions = useMemo(
    () =>
      countOptions(
        weekSessions,
        (session) => topicsByCode.get(session.moduleCode) ?? [],
        filters.topics,
      ),
    [weekSessions, topicsByCode, filters.topics],
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
    setSearchDraft({ query: '', value: '' })
    setSearchParams(
      selectedWeek ? { week: selectedWeek.week } : new URLSearchParams(),
      { replace: true },
    )
  }

  function toggleLectureToTimetable(session: LectureSession) {
    if (!snapshot || nusmodsLectureCodes.has(session.moduleCode)) {
      return
    }

    const academicYear = snapshot.pointer.acadYear
    const semester = snapshot.pointer.semester as Semester
    const sameAcademicYear = timetable.academicYear === academicYear
    const selectionsFor = (term: Semester) =>
      sameAcademicYear
        ? term === timetable.semester
          ? timetable.selections
          : (timetable.semesterSelections?.[term] ?? [])
        : []
    const semesterSelections: Record<Semester, TimetableSelection[]> = {
      1: selectionsFor(1),
      2: selectionsFor(2),
      3: selectionsFor(3),
      4: selectionsFor(4),
    }
    const alreadyAdded = discoverLectureCodes.has(session.moduleCode)
    semesterSelections[semester] = alreadyAdded
      ? semesterSelections[semester].filter(
          (selection) =>
            selection.moduleCode !== session.moduleCode ||
            selection.lessonType !== 'Lecture' ||
            selection.source !== 'discover',
        )
      : [
          ...semesterSelections[semester],
          {
            moduleCode: session.moduleCode,
            moduleTitle: session.moduleTitle,
            lessonType: 'Lecture',
            classNo: session.classNo,
            source: 'discover',
          },
        ]
    const nextTimetable: TimetableState = {
      academicYear,
      semester,
      selections: semesterSelections[semester],
      semesterSelections,
    }

    setNotice(
      `${session.moduleCode} ${alreadyAdded ? 'removed from' : 'added to'} your timetable.`,
    )
    setTimetable(nextTimetable)
    saveTimetable(nextTimetable)
    void saveRemoteTimetable(
      { academicYear, semesters: semesterSelections },
      getAccessToken,
    ).catch(() => undefined)
  }

  if (snapshotError) {
    return (
      <main className="discover-page">
        <DiscoveryHeader />
        <p className="status-message" role="alert">
          Lecture data is unavailable right now ({snapshotError}). Try again
          later.
        </p>
      </main>
    )
  }

  if (!snapshot || !selectedWeek) {
    return (
      <main className="discover-page">
        <DiscoveryHeader />
        <p className="discovery-loading" role="status">
          {snapshot
            ? 'No lectures have been published yet.'
            : 'Finding your next favourite lecture…'}
        </p>
      </main>
    )
  }

  const previewDate =
    activeFilters.days[0] ?? (weekDays.includes(today) ? today : weekDays[0])
  const advancedCount =
    filters.topics.length +
    filters.buildings.length +
    filters.codes.length +
    filters.faculties.length +
    filters.levels.length +
    Number(filters.from !== DEFAULT_FROM) +
    Number(filters.to !== DEFAULT_TO) +
    Number(filters.minSize > 0) +
    Number(filters.includeOnline) +
    Number(filters.myTopics)
  const hasFilters = Boolean(
    filters.query ||
    activeFilters.days.length ||
    advancedCount ||
    filters.hideClashes,
  )

  return (
    <main className="discover-page">
      <DiscoveryHeader
        term={formatTerm(snapshot.pointer.acadYear, snapshot.pointer.semester)}
      />
      <form
        className="discovery-search"
        aria-label="Lecture filters"
        onSubmit={(event) => event.preventDefault()}
        // Safari doesn't focus a clicked checkbox or button, so Tab would start
        // from nowhere; focus it so Tab and Shift+Tab start from the click.
        onClick={(event) => focusClickedField(event.target as Element)}
        onKeyDown={(event) => {
          const target = event.target as Element
          if (
            event.key !== 'Tab' ||
            event.altKey ||
            event.metaKey ||
            event.defaultPrevented ||
            // Dropdowns handle their own Tab; time inputs use Tab for their
            // hour and minute parts.
            target.closest('.multi-select') ||
            target.matches('input[type="time"]')
          ) {
            return
          }
          if (focusNeighbour(target, event.shiftKey)) event.preventDefault()
        }}
      >
        <div className="discovery-searchbar">
          <label className="discovery-query">
            <span className="visually-hidden">Search modules</span>
            <Icon name="search" />
            <input
              type="search"
              value={queryInput}
              placeholder="Search modules or topics"
              onChange={(event) => {
                setSearchDraft({
                  query: event.target.value.trim(),
                  value: event.target.value,
                })
                updateFilters({ query: event.target.value.trim() })
              }}
            />
          </label>
          <div className="discovery-week">
            <SelectField
              value={selectedWeek.week}
              onValueChange={(value) =>
                updateFilters({ week: value, days: [] })
              }
              aria-label="Week"
              options={weeks.map((week) => ({
                value: week.week,
                label: `${weekName(week.week)} · ${formatDate(week.startDate, { day: 'numeric', month: 'short' })}`,
              }))}
            />
          </div>
        </div>
        <div className="discovery-datebar">
          <fieldset>
            <legend className="visually-hidden">Days</legend>
            <div className="chip-row">
              {weekDays.map((day) => (
                <button
                  key={day}
                  type="button"
                  className="day-chip"
                  aria-pressed={activeFilters.days.includes(day)}
                  onClick={() =>
                    updateFilters({
                      days: toggleValue(activeFilters.days, day),
                    })
                  }
                >
                  <span>{formatDate(day, { weekday: 'short' })}</span>{' '}
                  <span>{formatDate(day, { day: 'numeric' })}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            className="chip starting-soon"
            disabled={!canShowSoon}
            title={
              canShowSoon ? undefined : 'No more lectures are scheduled today'
            }
            onClick={showStartingSoon}
          >
            <Icon name="clock" />
            Starting soon
          </button>
          {hasFilters && (
            <button
              type="button"
              className="clear-filters"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
          <button
            type="button"
            className="filter-toggle secondary"
            aria-expanded={filtersOpen}
            aria-controls="discovery-advanced-filters"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Icon name="sliders" />
            <span>Filters</span>
            {advancedCount > 0 && (
              <span className="filter-count">{advancedCount}</span>
            )}
          </button>
        </div>
        <div
          className="discover-filters"
          id="discovery-advanced-filters"
          hidden={!filtersOpen}
        >
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
          {topicOptions.length > 0 && (
            <MultiSelect
              label="Topics"
              options={topicOptions}
              selected={filters.topics}
              searchPlaceholder="Search topics"
              onChange={(topics) => updateFilters({ topics })}
            />
          )}
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
          <label>
            Minimum class size
            <SelectField
              value={String(filters.minSize)}
              onValueChange={(value) =>
                updateFilters({ minSize: Number(value) })
              }
              options={MIN_SIZE_OPTIONS.map((size) => ({
                value: String(size),
                label: size === 0 ? 'Any size' : `${size}+ students`,
              }))}
              aria-label="Minimum class size"
            />
          </label>
          <fieldset>
            <legend>Levels</legend>
            <div className="chip-row">
              {levels.map((level) => (
                <button
                  key={level}
                  type="button"
                  className="chip"
                  // Kept out of the Tab order so Tab goes from Minimum class
                  // size straight to the checkboxes below.
                  tabIndex={-1}
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
          <div className="my-topics">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={filters.myTopics && interestSet !== null}
                disabled={interestSet === null}
                onChange={(event) =>
                  updateFilters({ myTopics: event.target.checked })
                }
              />
              Only my topics
            </label>
            {interestSet === null && (
              <p className="filter-hint">
                {interests ? (
                  <>
                    Choose topics in your <Link to="/profile">Profile</Link>{' '}
                    first.
                  </>
                ) : (
                  <>
                    <Link to="/profile">Log in</Link> to search your interest
                    topics.
                  </>
                )}
              </p>
            )}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              // Left out of the Tab order; click to toggle.
              tabIndex={-1}
              checked={filters.includeOnline}
              onChange={(event) =>
                updateFilters({ includeOnline: event.target.checked })
              }
            />
            Include online lectures
          </label>
        </div>
      </form>
      <div className="discover-layout">
        <section className="discover-results" aria-label="Lectures">
          <div className="discovery-results-heading">
            <div>
              <h2 className="visually-hidden">Lectures</h2>
              <p className="results-count" aria-live="polite">
                {sessions ? (
                  <>
                    {results.length === 1
                      ? '1 lecture'
                      : `${results.length.toLocaleString()} lectures`}{' '}
                    in {weekName(selectedWeek.week)}
                  </>
                ) : (
                  `Finding lectures in ${weekName(selectedWeek.week)}…`
                )}
              </p>
            </div>
            <label
              className="checkbox clash-filter"
              title={
                timetableCheck === 'empty'
                  ? 'Add your modules in My Timetable to check for clashes'
                  : undefined
              }
            >
              <input
                type="checkbox"
                // Left out of the Tab order; click to toggle.
                tabIndex={-1}
                checked={filters.hideClashes}
                disabled={timetableCheck !== 'ready'}
                onChange={(event) =>
                  updateFilters({ hideClashes: event.target.checked })
                }
              />
              Hide clashes
            </label>
          </div>
          {filters.hideClashes && timetableCheck !== 'ready' && (
            <p className="filter-hint" role="status">
              {timetableCheck === 'loading'
                ? 'Checking your timetable before hiding clashes…'
                : 'Showing all matches until your timetable is available for clash checking.'}
            </p>
          )}
          {notice && (
            <p className="discovery-notice" role="status">
              <Icon name="check" />
              {notice}
            </p>
          )}
          {weekLoadError ? (
            <p className="status-message" role="alert">
              Unable to load {weekName(selectedWeek.week)} ({weekLoadError}).
            </p>
          ) : !sessions ? (
            <p className="discovery-loading" role="status">
              Loading {weekName(selectedWeek.week)}…
            </p>
          ) : (
            <>
              {results.length === 0 && (
                <div className="discovery-empty">
                  <Icon name="search" />
                  <h3>A little more room to explore?</h3>
                  <p>No lectures match these filters. Try widening them.</p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={clearFilters}
                  >
                    Reset your search
                  </button>
                </div>
              )}
              {visibleGroups.map(([date, daySessions]) => (
                <section key={date} className="day-group">
                  <h3>
                    {formatDate(date, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </h3>
                  <div className="session-list">
                    {daySessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        module={modulesByCode.get(session.moduleCode)}
                        addedToTimetable={addedLectureCodes.has(
                          session.moduleCode,
                        )}
                        disableAdd={nusmodsLectureCodes.has(session.moduleCode)}
                        timetableCheck={timetableCheck}
                        discussionPath={
                          parseRoomId(roomIdFor(session, snapshot.pointer))
                            ? roomPath(roomIdFor(session, snapshot.pointer))
                            : null
                        }
                        clashes={sessionClashes(
                          session,
                          teachingWeek(selectedWeek.week),
                          timetableLessons,
                        )}
                        onAddToTimetable={() =>
                          toggleLectureToTimetable(session)
                        }
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
        <DiscoveryRail
          days={weekDays}
          date={previewDate}
          week={selectedWeek.week}
          lessons={timetableLessons}
          timetableCheck={timetableCheck}
          onDateChange={(date) =>
            updateFilters({
              days:
                activeFilters.days.length === 1 &&
                activeFilters.days[0] === date
                  ? []
                  : [date],
            })
          }
        />
      </div>
      <footer className="discovery-footnote">
        <p>
          Drop in thoughtfully. Arrive on time, sit at the back and leave if
          asked.
        </p>
        <p>
          Lecture data updated{' '}
          {formatDate(snapshot.pointer.generatedAt.slice(0, 10), {
            day: 'numeric',
            month: 'short',
          })}
        </p>
      </footer>
    </main>
  )
}

export default DiscoverPage
