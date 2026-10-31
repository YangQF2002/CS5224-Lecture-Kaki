import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { SignInRequired, getAccessToken } from '../forum/auth.ts'
import SelectField, { EMPTY_SELECT_VALUE } from '../../SelectField.tsx'
import { fetchModule, fetchModuleList, isAcademicYear } from './nusmodsApi.ts'
import {
  parseNusmodsShareLink,
  resolveImportedTimetable,
} from './shareLinkParser.ts'
import { loadTimetable, saveTimetable } from './timetableStorage.ts'
import {
  getRemoteTimetable,
  saveRemoteTimetable,
  TimetableApiError,
} from './timetableApi.ts'
import {
  expandSelections,
  getModuleTimetable,
  lessonKey,
} from './timetableUtils.ts'
import type {
  ModuleSummary,
  NusmodsModule,
  Semester,
  TimetableSelection,
  TimetableState,
  Weeks,
} from './types.ts'
import './timetable.css'

const SCHEDULE_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
] as const

const DEFAULT_START_MINUTES = 8 * 60
const DEFAULT_END_MINUTES = 21 * 60
const DAY_ROW_HEIGHT_REM = 4.8
const LESSON_BLOCK_HEIGHT_REM = 4
const WEEK_OPTIONS = [
  ...Array.from({ length: 6 }, (_, index) => `Week ${index + 1}`),
  'Recess Week',
  ...Array.from({ length: 7 }, (_, index) => `Week ${index + 7}`),
  'Reading Week',
] as const

function timeToMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(2, 4))
}

function formatHour(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}${String(
    value % 60,
  ).padStart(2, '0')}`
}

const MODULE_COLORS = [
  'rose',
  'terracotta',
  'apricot',
  'olive',
  'teal',
  'sky',
  'lavender',
  'clay',
] as const

function moduleColor(
  moduleCode: string,
  selectedModuleCodes: string[],
): string {
  const index = selectedModuleCodes.indexOf(moduleCode)
  return MODULE_COLORS[(index < 0 ? 0 : index) % MODULE_COLORS.length]
}

function academicYearLabel(academicYear: string): string {
  const [start, end] = academicYear.split('-')
  return start && end ? `AY${start.slice(-2)}/${end.slice(-2)}` : academicYear
}

function semesterLabel(semester: Semester): string {
  return semester <= 2 ? `Semester ${semester}` : `Special Term ${semester - 2}`
}

function teachingWeekForIndex(index: number): number | null {
  if (index <= 5) return index + 1
  if (index === 6) return null
  if (index <= 13) return index
  return null
}

function lessonIsInTeachingWeek(weeks: Weeks, teachingWeek: number): boolean {
  if (Array.isArray(weeks)) return weeks.includes(teachingWeek)
  if (weeks.weeks) return weeks.weeks.includes(teachingWeek)

  return (teachingWeek - 1) % (weeks.weekInterval ?? 1) === 0
}

function getSemesterSelections(
  timetable: TimetableState,
): Record<Semester, TimetableSelection[]> {
  return {
    1: timetable.semesterSelections?.[1] ?? [],
    2: timetable.semesterSelections?.[2] ?? [],
    3: timetable.semesterSelections?.[3] ?? [],
    4: timetable.semesterSelections?.[4] ?? [],
    [timetable.semester]: timetable.selections,
  }
}

function isAuthConfigurationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith('Cognito login is not configured')
  )
}

function TimetablePage() {
  const [timetable, setTimetable] = useState(loadTimetable)
  const [academicYearInput, setAcademicYearInput] = useState(
    timetable.academicYear,
  )
  const [moduleList, setModuleList] = useState<ModuleSummary[]>([])
  const [modules, setModules] = useState<Record<string, NusmodsModule>>({})
  const [moduleQuery, setModuleQuery] = useState('')
  const [selectedModule, setSelectedModule] = useState<NusmodsModule | null>(
    null,
  )
  const [groupChoices, setGroupChoices] = useState<Record<string, string>>({})
  const [shareLink, setShareLink] = useState('')
  const [message, setMessage] = useState('')
  const [moduleLoadError, setModuleLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0)
  const requestId = useRef(0)
  const backendHydrated = useRef(false)

  function resetPicker() {
    // An earlier request may finish after a term change or a newer picker action.
    requestId.current += 1
    setLoading(false)
    setSelectedModule(null)
    setModuleQuery('')
    setGroupChoices({})
  }

  function changeTerm(academicYear: string, semester: Semester) {
    if (
      academicYear === timetable.academicYear &&
      semester === timetable.semester
    ) {
      return
    }
    resetPicker()
    setModules({})
    if (academicYear !== timetable.academicYear) {
      setModuleList([])
    }
    const semesterSelections =
      academicYear === timetable.academicYear
        ? getSemesterSelections(timetable)
        : { 1: [], 2: [], 3: [], 4: [] }
    setTimetable({
      academicYear,
      semester,
      selections: semesterSelections[semester],
      semesterSelections,
    })
    setMessage('')
  }

  function applyAcademicYear() {
    if (!isAcademicYear(academicYearInput)) {
      setMessage('Enter an academic year such as 2026-2027')
      setAcademicYearInput(timetable.academicYear)
      return
    }
    changeTerm(academicYearInput, timetable.semester)
  }

  useEffect(() => {
    saveTimetable(timetable)
  }, [timetable])

  useEffect(() => {
    let cancelled = false

    async function loadRemoteTimetable() {
      try {
        const book = await getRemoteTimetable(getAccessToken)
        if (!cancelled && book) {
          const semesterSelections: Record<Semester, TimetableSelection[]> = {
            1: book.semesters[1] ?? [],
            2: book.semesters[2] ?? [],
            3: book.semesters[3] ?? [],
            4: book.semesters[4] ?? [],
          }
          setAcademicYearInput(book.academicYear)
          setTimetable((current) => ({
            academicYear: book.academicYear,
            semester: current.semester,
            selections: semesterSelections[current.semester],
            semesterSelections,
          }))
        }
      } catch (error) {
        if (
          !cancelled &&
          !(error instanceof SignInRequired) &&
          !isAuthConfigurationError(error) &&
          !(error instanceof TimetableApiError && error.status === 404)
        ) {
          setMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load your saved timetable',
          )
        }
      } finally {
        if (!cancelled) backendHydrated.current = true
      }
    }

    void loadRemoteTimetable()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!backendHydrated.current) return
    let cancelled = false
    const book = {
      academicYear: timetable.academicYear,
      semesters: getSemesterSelections(timetable),
    }

    void saveRemoteTimetable(book, getAccessToken).catch((error: unknown) => {
      if (
        !cancelled &&
        !(error instanceof SignInRequired) &&
        !isAuthConfigurationError(error) &&
        !(error instanceof TimetableApiError && error.status === 401)
      ) {
        setMessage(
          error instanceof Error
            ? error.message
            : 'Unable to save your timetable',
        )
      }
    })

    return () => {
      cancelled = true
    }
  }, [timetable])

  useEffect(() => {
    let cancelled = false

    async function loadModuleList() {
      try {
        const result = await fetchModuleList(timetable.academicYear)

        if (!cancelled) {
          setModuleList(result)
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load the module list',
          )
        }
      }
    }

    void loadModuleList()

    return () => {
      cancelled = true
    }
  }, [timetable.academicYear])

  useEffect(() => {
    let cancelled = false
    const moduleCodes = [
      ...new Set(timetable.selections.map((selection) => selection.moduleCode)),
    ]

    async function loadSelectedModules() {
      const results = await Promise.allSettled(
        moduleCodes.map((moduleCode) =>
          fetchModule(timetable.academicYear, moduleCode),
        ),
      )

      if (!cancelled) {
        const loadedModules = results
          .filter((result) => result.status === 'fulfilled')
          .map((result) => result.value)
        const failedModules = moduleCodes.filter(
          (_, index) => results[index].status === 'rejected',
        )
        setModules(
          Object.fromEntries(
            loadedModules.map((module) => [module.moduleCode, module]),
          ),
        )
        setModuleLoadError(
          failedModules.length > 0
            ? `Unable to load timetable for: ${failedModules.join(', ')}.`
            : '',
        )
      }
    }

    void loadSelectedModules().catch((error: unknown) => {
      if (!cancelled) {
        setModuleLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to load timetable modules',
        )
      }
    })

    return () => {
      cancelled = true
    }
  }, [timetable.academicYear, timetable.selections])

  const searchResults = useMemo(() => {
    const query = moduleQuery.trim().toLowerCase()

    if (!query) {
      return []
    }

    return moduleList
      .filter(
        (module) =>
          module.semesters.includes(timetable.semester) &&
          (module.moduleCode.toLowerCase().includes(query) ||
            module.title.toLowerCase().includes(query)),
      )
      .slice(0, 12)
  }, [moduleList, moduleQuery, timetable.semester])

  const lessonGroups = useMemo(() => {
    if (!selectedModule) {
      return {}
    }

    const lessons = getModuleTimetable(selectedModule, timetable.semester)
    const groups: Record<string, Set<string>> = {}

    for (const lesson of lessons) {
      groups[lesson.lessonType] ??= new Set()
      groups[lesson.lessonType].add(lesson.classNo)
    }

    return Object.fromEntries(
      Object.entries(groups).map(([lessonType, classNumbers]) => [
        lessonType,
        [...classNumbers].sort(),
      ]),
    )
  }, [selectedModule, timetable.semester])

  const selectedModuleCodes = useMemo(() => {
    const codes = [
      ...new Set(timetable.selections.map((selection) => selection.moduleCode)),
    ]

    return codes
      .map((moduleCode, index) => ({
        moduleCode,
        index,
        discovered: timetable.selections.some(
          (selection) =>
            selection.moduleCode === moduleCode &&
            selection.source === 'discover',
        ),
      }))
      .sort(
        (first, second) =>
          Number(first.discovered) - Number(second.discovered) ||
          first.index - second.index,
      )
      .map(({ moduleCode }) => moduleCode)
  }, [timetable.selections])

  const lessons = useMemo(() => {
    const expanded = expandSelections(
      timetable.selections,
      modules,
      timetable.semester,
    )
    const teachingWeek = teachingWeekForIndex(selectedWeekIndex)

    return teachingWeek === null
      ? []
      : expanded.filter(
          (lesson) =>
            (lesson.selectedWeek === undefined ||
              lesson.selectedWeek === teachingWeek) &&
            lessonIsInTeachingWeek(lesson.weeks, teachingWeek),
        )
  }, [modules, selectedWeekIndex, timetable.selections, timetable.semester])

  const lessonStacks = useMemo(() => {
    const stacks = new Map<string, { index: number; count: number }>()

    for (const lesson of lessons) {
      const overlapping = lessons.filter(
        (other) =>
          other.day === lesson.day &&
          other.startTime < lesson.endTime &&
          lesson.startTime < other.endTime,
      )
      const index = overlapping.findIndex(
        (other) => lessonKey(other) === lessonKey(lesson),
      )

      if (overlapping.length > 1) {
        stacks.set(lessonKey(lesson), { index, count: overlapping.length })
      }
    }

    return stacks
  }, [lessons])

  function dayStackCount(day: (typeof SCHEDULE_DAYS)[number]): number {
    return Math.max(
      1,
      ...lessons
        .filter((lesson) => lesson.day === day)
        .map((lesson) => lessonStacks.get(lessonKey(lesson))?.count ?? 1),
    )
  }

  const scheduleRange = useMemo(() => {
    const start = Math.min(
      DEFAULT_START_MINUTES,
      ...lessons.map((lesson) => timeToMinutes(lesson.startTime)),
    )
    const end = Math.max(
      DEFAULT_END_MINUTES,
      ...lessons.map((lesson) => timeToMinutes(lesson.endTime)),
    )
    const gridStart = Math.floor(start / 60) * 60
    // Keep one complete empty hour after the latest lesson so the final
    // visible hour label also owns a full grid column.
    const gridEnd = Math.ceil(end / 60) * 60 + 60
    const hours = Array.from(
      { length: (gridEnd - gridStart) / 60 + 1 },
      (_, index) => gridStart + index * 60,
    )

    return { gridStart, gridEnd, hours }
  }, [lessons])

  async function chooseModule(moduleCode: string) {
    const currentRequest = ++requestId.current
    setLoading(true)
    setMessage('')

    try {
      const module = await fetchModule(timetable.academicYear, moduleCode)

      if (currentRequest !== requestId.current) return

      setSelectedModule(module)
      setModuleQuery(`${module.moduleCode} — ${module.title}`)
      setGroupChoices({})
    } catch (error) {
      if (currentRequest !== requestId.current) return
      setMessage(
        error instanceof Error ? error.message : 'Unable to load module',
      )
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }

  function addSelectedGroups() {
    if (!selectedModule) {
      return
    }

    const addedSelections: TimetableSelection[] = Object.entries(groupChoices)
      .filter(([, classNo]) => classNo)
      .map(([lessonType, classNo]) => ({
        moduleCode: selectedModule.moduleCode,
        moduleTitle: selectedModule.title,
        lessonType,
        classNo,
      }))

    if (addedSelections.length === 0) {
      setMessage('Select at least one lesson group')
      return
    }

    if (
      addedSelections.some(
        ({ lessonType, classNo }) =>
          !lessonGroups[lessonType]?.includes(classNo),
      )
    ) {
      setMessage('Select lesson groups offered in the current term')
      return
    }

    setTimetable((current) => {
      const selections = [
        ...current.selections.filter(
          (selection) =>
            selection.moduleCode !== selectedModule.moduleCode ||
            !addedSelections.some(
              (added) => added.lessonType === selection.lessonType,
            ),
        ),
        ...addedSelections,
      ]
      const semesterSelections = getSemesterSelections(current)
      semesterSelections[current.semester] = selections
      return { ...current, selections, semesterSelections }
    })

    setSelectedModule(null)
    setModuleQuery('')
    setGroupChoices({})
    setMessage(`${addedSelections[0].moduleCode} added`)
  }

  async function importShareLink() {
    const currentRequest = ++requestId.current
    setLoading(true)
    setMessage('')

    try {
      const parsedLink = parseNusmodsShareLink(shareLink)
      const result = await resolveImportedTimetable(
        parsedLink,
        timetable.academicYear,
      )

      if (currentRequest !== requestId.current) return

      if (result.selections.length === 0) {
        throw new Error(
          result.warnings.join('; ') || 'No lessons could be imported',
        )
      }

      if (
        timetable.selections.length > 0 &&
        !window.confirm(
          'Replace your current timetable with the imported timetable?',
        )
      ) {
        return
      }

      setTimetable((current) => {
        const semesterSelections = getSemesterSelections(current)
        semesterSelections[parsedLink.semester] = result.selections
        return {
          ...current,
          semester: parsedLink.semester,
          selections: result.selections,
          semesterSelections,
        }
      })

      resetPicker()
      setShareLink('')
      setMessage(
        result.warnings.length > 0
          ? `Imported with warnings: ${result.warnings.join('; ')}`
          : 'Timetable imported successfully',
      )
    } catch (error) {
      if (currentRequest !== requestId.current) return
      setMessage(error instanceof Error ? error.message : 'Import failed')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }

  function removeModule(moduleCode: string) {
    setTimetable((current) => {
      const selections = current.selections.filter(
        (selection) => selection.moduleCode !== moduleCode,
      )
      const semesterSelections = getSemesterSelections(current)
      semesterSelections[current.semester] = selections
      return { ...current, selections, semesterSelections }
    })
  }

  return (
    <main className="timetable-page">
      <header>
        <h1>My Timetable</h1>
        <p>Create a timetable or import a NUSMods share link.</p>
      </header>

      <section className="panel term-controls">
        <label>
          Academic year
          <input
            value={academicYearInput}
            pattern="\d{4}-\d{4}"
            onChange={(event) => setAcademicYearInput(event.target.value)}
            onBlur={applyAcademicYear}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </label>

        <label>
          Semester
          <SelectField
            value={String(timetable.semester)}
            options={[
              { value: '1', label: 'Semester 1' },
              { value: '2', label: 'Semester 2' },
              { value: '3', label: 'Special Term I' },
              { value: '4', label: 'Special Term II' },
            ]}
            aria-label="Semester"
            onValueChange={(value) =>
              changeTerm(timetable.academicYear, Number(value) as Semester)
            }
          />
        </label>
      </section>

      <section className="panel">
        <h2>Import from NUSMods</h2>
        <div className="inline-form">
          <input
            value={shareLink}
            placeholder="Paste a NUSMods timetable share link"
            onChange={(event) => setShareLink(event.target.value)}
          />
          <button
            disabled={loading || !shareLink.trim()}
            onClick={() => void importShareLink()}
          >
            Import
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Add a module</h2>
        <input
          value={moduleQuery}
          placeholder="Search by module code or title"
          onChange={(event) => {
            resetPicker()
            setModuleQuery(event.target.value)
          }}
        />

        {searchResults.length > 0 && !selectedModule && (
          <ul className="search-results">
            {searchResults.map((module) => (
              <li key={module.moduleCode}>
                <button
                  type="button"
                  onClick={() => void chooseModule(module.moduleCode)}
                >
                  <strong>{module.moduleCode}</strong> {module.title}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedModule && (
          <div className="group-picker">
            <h3>
              {selectedModule.moduleCode}: {selectedModule.title}
            </h3>

            {Object.entries(lessonGroups).map(([lessonType, classNumbers]) => (
              <label key={lessonType}>
                {lessonType}
                <SelectField
                  value={groupChoices[lessonType] || EMPTY_SELECT_VALUE}
                  options={[
                    { value: EMPTY_SELECT_VALUE, label: 'Do not add' },
                    ...classNumbers.map((classNo) => ({
                      value: classNo,
                      label: classNo,
                    })),
                  ]}
                  aria-label={lessonType}
                  onValueChange={(value) =>
                    setGroupChoices((current) => ({
                      ...current,
                      [lessonType]: value === EMPTY_SELECT_VALUE ? '' : value,
                    }))
                  }
                />
              </label>
            ))}

            <button disabled={loading} onClick={addSelectedGroups}>
              Add selected groups
            </button>
          </div>
        )}
      </section>

      {message && <p className="status-message">{message}</p>}
      {moduleLoadError && <p className="status-message">{moduleLoadError}</p>}

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Selected modules</h2>
          </div>
          {timetable.selections.length > 0 && (
            <span className="module-count">
              {
                new Set(
                  timetable.selections.map((selection) => selection.moduleCode),
                ).size
              }
            </span>
          )}
          {timetable.selections.length === 0 ? (
            <p>No modules added yet.</p>
          ) : (
            <div className="module-strip">
              {selectedModuleCodes.map((moduleCode) => {
                const moduleSelections = timetable.selections.filter(
                  (selection) => selection.moduleCode === moduleCode,
                )
                const moduleTitle = moduleSelections[0]?.moduleTitle ?? ''

                return (
                  <article
                    className={`selected-module module-card ${moduleColor(moduleCode, selectedModuleCodes)}`}
                    key={moduleCode}
                  >
                    <button
                      className="remove-module"
                      type="button"
                      aria-label="Remove"
                      title={`Remove ${moduleCode}`}
                      disabled={loading}
                      onClick={() => removeModule(moduleCode)}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                    <strong className="module-code">{moduleCode}</strong>
                    <span className="module-title">{moduleTitle}</span>
                    {moduleSelections.some(
                      (selection) => selection.source === 'discover',
                    ) && <span className="module-origin">From Discover</span>}
                    <ul>
                      {moduleSelections.map((selection) => (
                        <li
                          key={`${selection.lessonType}-${selection.week ?? ''}-${selection.day ?? ''}`}
                        >
                          {selection.lessonType}: {selection.classNo}
                          {selection.week !== undefined &&
                            ` · Week ${selection.week}`}
                          {selection.day && ` · ${selection.day}`}
                        </li>
                      ))}
                    </ul>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading schedule-heading">
          <div>
            <h2>Weekly schedule</h2>
            <p className="section-hint">
              {academicYearLabel(timetable.academicYear)} ·{' '}
              {semesterLabel(timetable.semester)}
            </p>
          </div>
          <div className="week-navigator" aria-label="Week navigator">
            <button
              type="button"
              aria-label="Previous week"
              disabled={selectedWeekIndex === 0}
              onClick={() =>
                setSelectedWeekIndex((index) => Math.max(0, index - 1))
              }
            >
              <span aria-hidden="true">‹</span>
            </button>
            <span>{WEEK_OPTIONS[selectedWeekIndex]}</span>
            <button
              type="button"
              aria-label="Next week"
              disabled={selectedWeekIndex === WEEK_OPTIONS.length - 1}
              onClick={() =>
                setSelectedWeekIndex((index) =>
                  Math.min(WEEK_OPTIONS.length - 1, index + 1),
                )
              }
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
          <div className="schedule-scroll">
            <div
              className="schedule-grid"
              style={
                {
                  '--schedule-columns': scheduleRange.hours.length - 1,
                } as CSSProperties
              }
            >
              <div className="schedule-corner" />
              <div className="schedule-hours">
                {scheduleRange.hours.slice(0, -1).map((hour) => (
                  <span key={hour}>{formatHour(hour)}</span>
                ))}
              </div>

              {SCHEDULE_DAYS.map((day) => (
                <div className="schedule-row" key={day}>
                  <div className="day-label">
                    {day.slice(0, 3).toUpperCase()}
                  </div>
                  <div
                    className="day-track"
                    style={{
                      minHeight: `${dayStackCount(day) * DAY_ROW_HEIGHT_REM}rem`,
                    }}
                  >
                    {scheduleRange.hours.slice(0, -1).map((hour, index) => (
                      <span
                        className="hour-line"
                        key={hour}
                        style={{
                          left: `${(index / (scheduleRange.hours.length - 1)) * 100}%`,
                        }}
                      />
                    ))}
                    {lessons
                      .filter((lesson) => lesson.day === day)
                      .map((lesson) => {
                        const key = lessonKey(lesson)
                        const stack = lessonStacks.get(key)
                        const left =
                          ((timeToMinutes(lesson.startTime) -
                            scheduleRange.gridStart) /
                            (scheduleRange.gridEnd - scheduleRange.gridStart)) *
                          100
                        const width =
                          ((timeToMinutes(lesson.endTime) -
                            timeToMinutes(lesson.startTime)) /
                            (scheduleRange.gridEnd - scheduleRange.gridStart)) *
                          100

                        return (
                          <article
                            className={`lesson-block ${moduleColor(lesson.moduleCode, selectedModuleCodes)}`}
                            key={key}
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              ...(stack
                                ? {
                                    top: `calc(0.4rem + ${stack.index * DAY_ROW_HEIGHT_REM}rem)`,
                                    bottom: 'auto',
                                    height: `${LESSON_BLOCK_HEIGHT_REM}rem`,
                                  }
                                : {}),
                            }}
                            title={`${lesson.moduleCode} · ${lesson.lessonType} ${lesson.classNo} · ${lesson.startTime}-${lesson.endTime}`}
                          >
                            <strong>{lesson.moduleCode}</strong>
                            <span>
                              {lesson.lessonType} {lesson.classNo}
                            </span>
                            <small>{lesson.venue || 'Venue TBA'}</small>
                          </article>
                        )
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export default TimetablePage
