import { lessonMeetsOn } from '../timetable/timetableUtils.ts'
import type { TimetableLesson } from '../timetable/types.ts'
import type { LectureSession } from './types.ts'

export type TimetableCheck = 'empty' | 'loading' | 'ready' | 'unavailable'

// "week-7" -> 7; recess, reading and exam weeks have no teaching-week number.
export function teachingWeek(label: string): number | null {
  const match = /^week-(\d+)$/.exec(label)
  return match ? Number(match[1]) : null
}

/** Timetable lessons of other modules that overlap this session. */
export function sessionClashes(
  session: LectureSession,
  week: number | null,
  lessons: TimetableLesson[],
): TimetableLesson[] {
  // Discover times are HH:MM; NUSMods lesson times are HHMM.
  const start = session.startTime.replace(':', '')
  const end = session.endTime.replace(':', '')
  return lessons.filter(
    (lesson) =>
      lesson.moduleCode !== session.moduleCode &&
      lesson.startTime < end &&
      start < lesson.endTime &&
      lessonMeetsOn(lesson, session.date, week),
  )
}
