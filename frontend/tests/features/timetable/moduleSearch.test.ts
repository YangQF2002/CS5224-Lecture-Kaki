import { expect, it } from 'vitest'
import { searchModules } from '../../../src/features/timetable/moduleSearch.ts'
import type { ModuleSummary } from '../../../src/features/timetable/types.ts'

const module = (
  moduleCode: string,
  title: string,
  semesters = [1, 2],
): ModuleSummary => ({ moduleCode, title, semesters })

const modules = [
  module('BT2102', 'Data Management and Visualisation'),
  module('CS2030', 'Programming Methodology II'),
  module('CS2030S', 'Programming Methodology II'),
  module('CS1010', 'Programming Methodology'),
  module('DSA1101', 'Introduction to Data Science'),
  module('DTK1234', 'Design Thinking'),
  module('GEA1000', 'Quantitative Reasoning with Data'),
  module('MA2001', 'Linear Algebra I', [2]),
  module('AB1000', 'Treason in History'),
]
const codes = (query: string, semester = 1) =>
  searchModules(modules, query, semester).map((result) => result.moduleCode)

it('ranks an exact code first, then codes that start with it', () => {
  expect(codes('cs2030')).toEqual(['CS2030', 'CS2030S'])
  expect(codes('CS 2030')).toEqual(['CS2030', 'CS2030S'])
})

it('ranks titles starting with the query above other matches', () => {
  // "Data Management…" starts with "data"; the others only contain it.
  expect(codes('data')).toEqual(['BT2102', 'DSA1101', 'GEA1000'])
})

it('matches every word in any order, across code and title', () => {
  expect(codes('methodology programming')).toEqual([
    'CS1010',
    'CS2030',
    'CS2030S',
  ])
  expect(codes('cs2030 methodology')).toEqual(['CS2030', 'CS2030S'])
  expect(codes('data design')).toEqual([])
})

it('ranks word-start matches above matches inside a word', () => {
  // GEA1000's title has a word starting "reason"; AB1000 only contains it
  // ("Treason"), so it comes second despite sorting first by code.
  expect(codes('reason')).toEqual(['GEA1000', 'AB1000'])
  expect(codes('intro data')).toEqual(['DSA1101'])
})

it('only returns modules offered in the semester', () => {
  expect(codes('linear')).toEqual([])
  expect(codes('linear', 2)).toEqual(['MA2001'])
})

it('returns nothing for an empty search', () => {
  expect(codes('   ')).toEqual([])
})
