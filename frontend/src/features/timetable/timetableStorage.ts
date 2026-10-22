import {
  getCurrentAcademicYear,
  getDefaultSemester,
  isAcademicYear,
} from './nusmodsApi.ts'
import type { TimetableSelection, TimetableState } from './types.ts'

const STORAGE_KEY = 'lecture-kaki:timetable:v1'

function isSelection(value: unknown): value is TimetableSelection {
  if (typeof value !== 'object' || value === null) return false
  const selection = value as Partial<TimetableSelection>
  return [
    selection.moduleCode,
    selection.moduleTitle,
    selection.lessonType,
    selection.classNo,
  ].every((field) => typeof field === 'string' && field.trim().length > 0)
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
    return {
      academicYear,
      semester: state.semester,
      selections: state.selections,
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
