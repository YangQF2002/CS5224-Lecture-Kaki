import type {
  Day,
  NusmodsModule,
  RawLesson,
  Semester,
  TimetableLesson,
  TimetableSelection,
  WeekRange,
  Weeks,
} from './types.ts'

const DAY_ORDER = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

export function getModuleTimetable(
  module: NusmodsModule,
  semester: Semester,
): RawLesson[] {
  return (
    module.semesterData.find((entry) => entry.semester === semester)
      ?.timetable ?? []
  )
}

export function expandSelections(
  selections: TimetableSelection[],
  modules: Record<string, NusmodsModule>,
  semester: Semester,
): TimetableLesson[] {
  return selections
    .flatMap((selection) => {
      const module = modules[selection.moduleCode]

      if (!module) {
        return []
      }

      return getModuleTimetable(module, semester)
        .filter(
          (lesson) =>
            lesson.lessonType === selection.lessonType &&
            lesson.classNo === selection.classNo &&
            (!selection.day || lesson.day === selection.day) &&
            (!selection.week ||
              (Array.isArray(lesson.weeks)
                ? lesson.weeks.includes(selection.week)
                : lesson.weeks.weeks?.includes(selection.week) ??
                  (selection.week - 1) % (lesson.weeks.weekInterval ?? 1) ===
                    0)),
        )
        .map((lesson) => ({
          ...lesson,
          moduleCode: selection.moduleCode,
          moduleTitle: selection.moduleTitle,
          selectedWeek: selection.week,
        }))
    })
    .sort((left, right) => {
      const dayDifference =
        DAY_ORDER.indexOf(left.day) - DAY_ORDER.indexOf(right.day)

      return (
        dayDifference ||
        left.startTime.localeCompare(right.startTime) ||
        left.moduleCode.localeCompare(right.moduleCode)
      )
    })
}

type Conflict = 'confirmed' | 'possible'

function occurrenceDates(range: WeekRange, day: Day): number[] {
  const dayLength = 24 * 60 * 60 * 1000
  const weekLength = 7 * dayLength
  const start = Date.parse(`${range.start}T00:00:00Z`)
  const end = Date.parse(`${range.end}T00:00:00Z`)
  const weekday = (DAY_ORDER.indexOf(day) + 1) % 7
  const offset = (weekday - new Date(start).getUTCDay() + 7) % 7
  const dates: number[] = []

  // Range week numbers start at the range's first occurrence, not semester Week 1.
  // UTC arithmetic keeps Singapore course dates independent of the browser timezone.
  for (let date = start + offset * dayLength; date <= end; date += weekLength) {
    const week = Math.floor((date - start) / weekLength) + 1
    const included = range.weeks
      ? range.weeks.includes(week)
      : (week - 1) % (range.weekInterval ?? 1) === 0
    if (included) dates.push(date)
  }
  return dates
}

export function lessonConflict(
  left: TimetableLesson,
  right: TimetableLesson,
): Conflict | null {
  if (
    left.day !== right.day ||
    left.startTime >= right.endTime ||
    right.startTime >= left.endTime
  )
    return null

  if (Array.isArray(left.weeks) && Array.isArray(right.weeks)) {
    const rightWeeks = new Set(right.weeks)
    return left.weeks.some((week) => rightWeeks.has(week)) ? 'confirmed' : null
  }

  if (!Array.isArray(left.weeks) && !Array.isArray(right.weeks)) {
    const rightDates = new Set(occurrenceDates(right.weeks, right.day))
    return occurrenceDates(left.weeks, left.day).some((date) =>
      rightDates.has(date),
    )
      ? 'confirmed'
      : null
  }

  const hasOccurrences = (weeks: Weeks) =>
    Array.isArray(weeks)
      ? weeks.length > 0
      : occurrenceDates(weeks, left.day).length > 0
  // Numeric semester weeks and absolute dates need a semester calendar to align.
  return hasOccurrences(left.weeks) && hasOccurrences(right.weeks)
    ? 'possible'
    : null
}

export function findConflicts(
  lessons: TimetableLesson[],
): Map<string, Conflict> {
  const conflicts = new Map<string, Conflict>()

  for (let leftIndex = 0; leftIndex < lessons.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < lessons.length;
      rightIndex += 1
    ) {
      const conflict = lessonConflict(lessons[leftIndex], lessons[rightIndex])
      if (conflict) {
        for (const lesson of [lessons[leftIndex], lessons[rightIndex]]) {
          const key = lessonKey(lesson)
          if (conflicts.get(key) !== 'confirmed') conflicts.set(key, conflict)
        }
      }
    }
  }

  return conflicts
}

export function lessonKey(lesson: TimetableLesson): string {
  return [
    lesson.moduleCode,
    lesson.lessonType,
    lesson.classNo,
    lesson.day,
    lesson.startTime,
    lesson.endTime,
    lesson.venue,
    JSON.stringify(lesson.weeks),
  ].join(':')
}
