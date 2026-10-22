import { expect, it } from 'vitest'
import { lessonConflict } from './timetableUtils.ts'
import type { TimetableLesson } from './types.ts'

const lesson: TimetableLesson = {
  moduleCode: 'CS1010',
  moduleTitle: 'Synthetic module',
  lessonType: 'Lecture',
  classNo: '1',
  day: 'Monday',
  startTime: '1000',
  endTime: '1200',
  venue: 'LT1',
  weeks: [1, 3],
}

it.each([
  [{ weeks: [3] }, 'confirmed'],
  [{ weeks: [2, 4] }, null],
  [{ startTime: '1200', endTime: '1300' }, null],
])('checks time and teaching-week overlap: %j', (other, expected) => {
  expect(lessonConflict(lesson, { ...lesson, ...other })).toBe(expected)
})

it('does not report a conflict for lessons in different date ranges', () => {
  expect(
    lessonConflict(
      { ...lesson, weeks: { start: '2026-08-10', end: '2026-08-24' } },
      { ...lesson, weeks: { start: '2026-10-05', end: '2026-10-19' } },
    ),
  ).toBeNull()
})

it('compares actual dates for intervals and range-relative weeks', () => {
  const fortnightly = {
    ...lesson,
    weeks: { start: '2026-08-10', end: '2026-08-31', weekInterval: 2 },
  }
  expect(
    lessonConflict(fortnightly, {
      ...lesson,
      weeks: {
        start: '2026-08-17',
        end: '2026-08-31',
        weekInterval: 2,
      },
    }),
  ).toBeNull()
  expect(
    lessonConflict(fortnightly, {
      ...lesson,
      weeks: {
        start: '2026-08-17',
        end: '2026-08-31',
        weeks: [2],
      },
    }),
  ).toBe('confirmed')
  expect(
    lessonConflict(fortnightly, {
      ...lesson,
      weeks: {
        start: '2026-08-17',
        end: '2026-08-31',
        weeks: [1],
      },
    }),
  ).toBeNull()
})

it('marks mixed week representations as possible rather than definite conflicts', () => {
  expect(
    lessonConflict(lesson, {
      ...lesson,
      weeks: {
        start: '2026-08-10',
        end: '2026-08-24',
      },
    }),
  ).toBe('possible')
})
