import type {
  NusmodsModule,
  RawLesson,
  Semester,
  TimetableLesson,
  TimetableSelection,
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
            lesson.classNo === selection.classNo,
        )
        .map((lesson) => ({
          ...lesson,
          moduleCode: selection.moduleCode,
          moduleTitle: selection.moduleTitle,
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

function numericWeeks(weeks: Weeks): number[] | null {
  if (Array.isArray(weeks)) {
    return weeks
  }

  return weeks.weeks ?? null
}

function teachingWeeksOverlap(left: Weeks, right: Weeks): boolean {
  const leftWeeks = numericWeeks(left)
  const rightWeeks = numericWeeks(right)

  // If the API gives only date ranges, conservatively treat them as overlapping.
  if (!leftWeeks || !rightWeeks) {
    return true
  }

  const rightSet = new Set(rightWeeks)
  return leftWeeks.some((week) => rightSet.has(week))
}

export function lessonsConflict(
  left: TimetableLesson,
  right: TimetableLesson,
): boolean {
  return (
    left.day === right.day &&
    left.startTime < right.endTime &&
    right.startTime < left.endTime &&
    teachingWeeksOverlap(left.weeks, right.weeks)
  )
}

export function findConflictKeys(
  lessons: TimetableLesson[],
): Set<string> {
  const conflicts = new Set<string>()

  for (let leftIndex = 0; leftIndex < lessons.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < lessons.length;
      rightIndex += 1
    ) {
      if (lessonsConflict(lessons[leftIndex], lessons[rightIndex])) {
        conflicts.add(lessonKey(lessons[leftIndex]))
        conflicts.add(lessonKey(lessons[rightIndex]))
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
  ].join(':')
}
