import {
  getCurrentAcademicYear,
  getDefaultSemester,
  isAcademicYear,
} from './nusmodsApi.ts'
import type { Semester, TimetableSelection, TimetableState } from './types.ts'

const STORAGE_KEY = 'lecture-kaki:timetable:v1'

function isSelection(value: unknown): value is TimetableSelection {
  if (typeof value !== 'object' || value === null) return false
  const selection = value as Partial<TimetableSelection>
  return (
    [
      selection.moduleCode,
      selection.moduleTitle,
      selection.lessonType,
      selection.classNo,
    ].every((field) => typeof field === 'string' && field.trim().length > 0) &&
    (selection.day === undefined || typeof selection.day === 'string') &&
    (selection.week === undefined ||
      (typeof selection.week === 'number' &&
        Number.isInteger(selection.week) &&
        selection.week >= 1 &&
        selection.week <= 13)) &&
    (selection.source === undefined || selection.source === 'discover')
  )
}

export function loadTimetable(): TimetableState {
  const fallback: TimetableState = {
    academicYear: getCurrentAcademicYear(),
    semester: getDefaultSemester(),
    selections: [],
  }

  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    )
    if (typeof stored !== 'object' || stored === null) return fallback
    const state = stored as Partial<TimetableState>
    // Earlier saves used a slash even though API requests require a hyphen.
    const academicYear =
      typeof state.academicYear === 'string'
        ? state.academicYear.replace('/', '-')
        : ''
    if (
      !isAcademicYear(academicYear) ||
      state.semester === undefined ||
      ![1, 2, 3, 4].includes(state.semester) ||
      !Array.isArray(state.selections) ||
      !state.selections.every(isSelection)
    )
      return fallback
    const semesterSelections: Partial<Record<Semester, TimetableSelection[]>> =
      {}
    if (
      state.semesterSelections &&
      typeof state.semesterSelections === 'object'
    ) {
      for (const semester of [1, 2, 3, 4] as const) {
        const selections = state.semesterSelections[semester]
        if (Array.isArray(selections) && selections.every(isSelection)) {
          semesterSelections[semester] = selections
        }
      }
    }
    semesterSelections[state.semester] = state.selections

    return {
      academicYear,
      semester: state.semester,
      selections: state.selections,
      semesterSelections,
    }
  } catch {
    return fallback
  }
}

export function saveTimetable(timetable: TimetableState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timetable))
  } catch {
    // Storage is optional: keep the current timetable usable in memory.
  }
}
