import { expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  buildRankFields,
  buildSearchText,
  chooseDefaultWeek,
  filterSessions,
  filtersToParams,
  parseFilters,
  rankWithinDays,
  singaporeNow,
  weekName,
  type DiscoveryFilters,
} from '../../../src/features/discovery/discoveryFilters.ts'
import type {
  LectureModule,
  LectureSession,
  LectureWeek,
} from '../../../src/features/discovery/types.ts'

const session: LectureSession = {
  id: 'CS1010-LEC-1@2026-10-27-1000-COM1-0207',
  moduleCode: 'CS1010',
  crossListed: [],
  moduleTitle: 'Synthetic programming',
  faculty: 'Computing',
  department: 'Computer Science',
  level: 1000,
  lessonType: 'Lecture',
  classNo: '1',
  date: '2026-10-27',
  startTime: '10:00',
  endTime: '12:00',
  venue: 'COM1-0207',
  building: 'COM1',
  online: false,
  size: 120,
}

const module: LectureModule = {
  moduleCode: 'CS1010',
  title: 'Synthetic programming',
  faculty: 'Computing',
  department: 'Computer Science',
  level: 1000,
  moduleCredit: '4',
  description: 'Introduces problem solving with machine learning examples.',
}

const searchText = buildSearchText([module])

function matches(
  filters: Partial<DiscoveryFilters>,
  overrides: Partial<LectureSession> = {},
): boolean {
  return (
    filterSessions(
      [{ ...session, ...overrides }],
      { ...DEFAULT_FILTERS, ...filters },
      searchText,
    ).length === 1
  )
}

it('round-trips filters through the query string and omits defaults', () => {
  const filters: DiscoveryFilters = {
    ...DEFAULT_FILTERS,
    week: 'week-11',
    days: ['2026-10-27'],
    from: '09:00',
    buildings: ['COM1', 'other'],
    codes: ['CS'],
    levels: [1000, 2000],
    minSize: 100,
    query: 'machine learning',
    includeOnline: true,
    hideClashes: true,
  }

  const params = filtersToParams(filters)

  expect(params.has('to')).toBe(false)
  expect(params.has('faculties')).toBe(false)
  expect(parseFilters(params)).toEqual(filters)
  expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('')
})

it('ignores malformed query parameters', () => {
  expect(
    parseFilters(
      new URLSearchParams(
        'from=25:00&days=tomorrow&levels=abc,3000&minSize=-5&codes=cs',
      ),
    ),
  ).toEqual({
    ...DEFAULT_FILTERS,
    codes: ['CS'],
    levels: [3000],
  })
})

it.each([
  [{ from: '10:00', to: '12:00' }, true],
  [{ from: '10:30' }, false],
  [{ to: '11:30' }, false],
  [{ days: ['2026-10-28'] }, false],
  [{ buildings: ['COM1'] }, true],
  [{ buildings: ['AS4'] }, false],
  [{ codes: ['CS'] }, true],
  [{ codes: ['C'] }, false],
  [{ faculties: ['Science'] }, false],
  [{ levels: [1000] }, true],
  [{ levels: [2000] }, false],
  [{ minSize: 200 }, false],
  [{ query: 'LEARNING cs1010' }, true],
  [{ query: 'machine biology' }, false],
])('applies %j', (filters, expected) => {
  expect(matches(filters)).toBe(expected)
})

it('selects unmapped in-person venues with the other-venues option', () => {
  expect(matches({ buildings: ['other'] }, { building: null })).toBe(true)
  expect(matches({ buildings: ['other'] })).toBe(false)
})

it('hides online lectures unless they are included', () => {
  const online = { online: true, building: null, venue: 'E-Learn_C' }
  expect(matches({}, online)).toBe(false)
  expect(matches({ includeOnline: true }, online)).toBe(true)
})

it('matches cross-listed codes and excludes unknown levels', () => {
  expect(matches({ codes: ['ACC'] }, { crossListed: ['ACC1010'] })).toBe(true)
  expect(matches({ levels: [1000] }, { level: null })).toBe(false)
})

const weeks: LectureWeek[] = [
  {
    week: 'week-10',
    startDate: '2026-10-19',
    endDate: '2026-10-25',
    sessionCount: 1,
  },
  {
    week: 'week-11',
    startDate: '2026-10-26',
    endDate: '2026-11-01',
    sessionCount: 1,
  },
]

it.each([
  ['2026-10-27', 'week-11'],
  ['2026-10-24', 'week-10'], // Saturday: still this week
  ['2026-10-25', 'week-11'], // Sunday: next week
  ['2026-08-01', 'week-10'],
  ['2026-12-01', 'week-11'],
])('chooses the default week for %s', (today, expected) => {
  expect(chooseDefaultWeek(weeks, today)).toBe(expected)
  expect(chooseDefaultWeek([], today)).toBeNull()
})

it('reads the date and time in Singapore', () => {
  expect(singaporeNow(new Date('2026-10-26T17:30:00Z'))).toEqual({
    date: '2026-10-27',
    minutes: 90,
  })
})

it.each([
  ['week-03', 'Week 3'],
  ['recess', 'Recess week'],
  ['reading', 'Reading week'],
  ['exam-2', 'Exam week 2'],
])('names %s', (week, expected) => {
  expect(weekName(week)).toBe(expected)
})

it('ranks search matches best first within each day', () => {
  const lecture = (
    moduleCode: string,
    title: string,
    date: string,
    startTime: string,
    topics: string[] = [],
  ) => ({
    session: { ...session, moduleCode, moduleTitle: title, date, startTime },
    module: { ...module, moduleCode, title, topics },
  })
  const lectures = [
    lecture('CS3223', 'Database Systems', '2026-10-27', '08:00'),
    lecture('EE1000', 'Signals', '2026-10-27', '09:00'), // description only
    lecture('GEA1000', 'Reasoning with Data', '2026-10-27', '10:00'),
    lecture('BT1000', 'Analytics', '2026-10-27', '11:00', ['Data & AI']),
    lecture('ST1131', 'Introduction to Data Science', '2026-10-28', '08:00'),
  ]
  const fields = buildRankFields(lectures.map((item) => item.module))
  const rank = (query: string) =>
    rankWithinDays(
      lectures.map((item) => item.session),
      query,
      fields,
    ).map((result) => result.moduleCode)

  // Title starts with it, then a title word, then a topic, then description;
  // the next day's lectures still come after.
  expect(rank('data')).toEqual([
    'CS3223',
    'GEA1000',
    'BT1000',
    'EE1000',
    'ST1131',
  ])
  // A code match comes first; the rest keep their time order.
  expect(rank('gea')).toEqual([
    'GEA1000',
    'CS3223',
    'EE1000',
    'BT1000',
    'ST1131',
  ])
  // No search: unchanged.
  expect(rank('')).toEqual(['CS3223', 'EE1000', 'GEA1000', 'BT1000', 'ST1131'])
})
