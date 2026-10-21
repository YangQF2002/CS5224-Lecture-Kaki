import { useEffect, useMemo, useState } from 'react'
import {
  fetchModule,
  fetchModuleList,
  getCurrentAcademicYear,
  getDefaultSemester,
} from './nusmodsApi.ts'
import {
  parseNusmodsShareLink,
  resolveImportedTimetable,
} from './shareLinkParser.ts'
import {
  expandSelections,
  findConflictKeys,
  getModuleTimetable,
  lessonKey,
} from './timetableUtils.ts'
import type {
  ModuleSummary,
  NusmodsModule,
  Semester,
  TimetableSelection,
  TimetableState,
} from './types.ts'
import './timetable.css'

const STORAGE_KEY = 'lecture-kaki:timetable:v1'

function initialState(): TimetableState {
  const fallback: TimetableState = {
    academicYear: getCurrentAcademicYear(),
    semester: getDefaultSemester(),
    selections: [],
  }

  const storedValue = localStorage.getItem(STORAGE_KEY)

  if (!storedValue) {
    return fallback
  }

  try {
    return JSON.parse(storedValue) as TimetableState
  } catch {
    return fallback
  }
}

function TimetablePage() {
  const [timetable, setTimetable] = useState(initialState)
  const [moduleList, setModuleList] = useState<ModuleSummary[]>([])
  const [modules, setModules] = useState<Record<string, NusmodsModule>>({})
  const [moduleQuery, setModuleQuery] = useState('')
  const [selectedModule, setSelectedModule] =
    useState<NusmodsModule | null>(null)
  const [groupChoices, setGroupChoices] = useState<Record<string, string>>({})
  const [shareLink, setShareLink] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timetable))
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
      ...new Set(
        timetable.selections.map((selection) => selection.moduleCode),
      ),
    ]

    async function loadSelectedModules() {
      const loadedModules = await Promise.all(
        moduleCodes.map((moduleCode) =>
          fetchModule(timetable.academicYear, moduleCode),
        ),
      )

      if (!cancelled) {
        setModules(
          Object.fromEntries(
            loadedModules.map((module) => [module.moduleCode, module]),
          ),
        )
      }
    }

    void loadSelectedModules().catch((error: unknown) => {
      if (!cancelled) {
        setMessage(
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

    const lessons = getModuleTimetable(
      selectedModule,
      timetable.semester,
    )
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

  const lessons = useMemo(
    () =>
      expandSelections(
        timetable.selections,
        modules,
        timetable.semester,
      ),
    [modules, timetable.selections, timetable.semester],
  )

  const conflictKeys = useMemo(
    () => findConflictKeys(lessons),
    [lessons],
  )

  async function chooseModule(moduleCode: string) {
    setLoading(true)
    setMessage('')

    try {
      const module = await fetchModule(
        timetable.academicYear,
        moduleCode,
      )

      setSelectedModule(module)
      setModuleQuery(`${module.moduleCode} — ${module.title}`)
      setGroupChoices({})
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to load module',
      )
    } finally {
      setLoading(false)
    }
  }

  function addSelectedGroups() {
    if (!selectedModule) {
      return
    }

    const addedSelections: TimetableSelection[] = Object.entries(
      groupChoices,
    )
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

    setTimetable((current) => ({
      ...current,
      selections: [
        ...current.selections.filter(
          (selection) =>
            selection.moduleCode !== selectedModule.moduleCode,
        ),
        ...addedSelections,
      ],
    }))

    setSelectedModule(null)
    setModuleQuery('')
    setGroupChoices({})
    setMessage(`${addedSelections[0].moduleCode} added`)
  }

  async function importShareLink() {
    setLoading(true)
    setMessage('')

    try {
      const parsedLink = parseNusmodsShareLink(shareLink)
      const result = await resolveImportedTimetable(
        parsedLink,
        timetable.academicYear,
      )

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

      setTimetable((current) => ({
        ...current,
        semester: parsedLink.semester,
        selections: result.selections,
      }))

      setShareLink('')
      setMessage(
        result.warnings.length > 0
          ? `Imported with warnings: ${result.warnings.join('; ')}`
          : 'Timetable imported successfully',
      )
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Import failed',
      )
    } finally {
      setLoading(false)
    }
  }

  function removeModule(moduleCode: string) {
    setTimetable((current) => ({
      ...current,
      selections: current.selections.filter(
        (selection) => selection.moduleCode !== moduleCode,
      ),
    }))
  }

  return (
    <main className="timetable-page">
      <header>
        <h1>My timetable</h1>
        <p>Create a timetable or import a NUSMods share link.</p>
      </header>

      <section className="panel term-controls">
        <label>
          Academic year
          <input
            value={timetable.academicYear}
            pattern="\d{4}-\d{4}"
            onChange={(event) =>
              setTimetable({
                academicYear: event.target.value,
                semester: timetable.semester,
                selections: [],
              })
            }
          />
        </label>

        <label>
          Semester
          <select
            value={timetable.semester}
            onChange={(event) =>
              setTimetable({
                ...timetable,
                semester: Number(event.target.value) as Semester,
                selections: [],
              })
            }
          >
            <option value={1}>Semester 1</option>
            <option value={2}>Semester 2</option>
            <option value={3}>Special Term I</option>
            <option value={4}>Special Term II</option>
          </select>
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
            setModuleQuery(event.target.value)
            setSelectedModule(null)
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

            {Object.entries(lessonGroups).map(
              ([lessonType, classNumbers]) => (
                <label key={lessonType}>
                  {lessonType}
                  <select
                    value={groupChoices[lessonType] ?? ''}
                    onChange={(event) =>
                      setGroupChoices((current) => ({
                        ...current,
                        [lessonType]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Do not add</option>
                    {classNumbers.map((classNo) => (
                      <option key={classNo} value={classNo}>
                        {classNo}
                      </option>
                    ))}
                  </select>
                </label>
              ),
            )}

            <button onClick={addSelectedGroups}>Add selected groups</button>
          </div>
        )}
      </section>

      {message && <p className="status-message">{message}</p>}

      <section className="panel">
        <h2>Selected modules</h2>

        {timetable.selections.length === 0 ? (
          <p>No modules added yet.</p>
        ) : (
          [
            ...new Set(
              timetable.selections.map(
                (selection) => selection.moduleCode,
              ),
            ),
          ].map((moduleCode) => (
            <div className="selected-module" key={moduleCode}>
              <div>
                <strong>{moduleCode}</strong>
                <ul>
                  {timetable.selections
                    .filter(
                      (selection) =>
                        selection.moduleCode === moduleCode,
                    )
                    .map((selection) => (
                      <li key={selection.lessonType}>
                        {selection.lessonType}: {selection.classNo}
                      </li>
                    ))}
                </ul>
              </div>
              <button onClick={() => removeModule(moduleCode)}>
                Remove
              </button>
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <h2>Weekly schedule</h2>

        {lessons.length === 0 ? (
          <p>No lessons to display.</p>
        ) : (
          <div className="lesson-list">
            {lessons.map((lesson) => {
              const key = lessonKey(lesson)
              const hasConflict = conflictKeys.has(key)

              return (
                <article
                  className={`lesson ${hasConflict ? 'conflict' : ''}`}
                  key={key}
                >
                  <div>
                    <strong>{lesson.moduleCode}</strong>{' '}
                    {lesson.lessonType} {lesson.classNo}
                  </div>
                  <div>
                    {lesson.day}, {lesson.startTime}–{lesson.endTime}
                  </div>
                  <div>{lesson.venue || 'Venue not announced'}</div>
                  {hasConflict && (
                    <div className="conflict-label">
                      Timetable conflict
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}

export default TimetablePage