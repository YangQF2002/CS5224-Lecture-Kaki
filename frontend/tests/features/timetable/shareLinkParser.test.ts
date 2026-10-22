import { beforeEach, expect, it, vi } from 'vitest'
import { fetchModule } from '../../../src/features/timetable/nusmodsApi.ts'
import {
  parseNusmodsShareLink,
  resolveImportedTimetable,
} from '../../../src/features/timetable/shareLinkParser.ts'
import type {
  NusmodsModule,
  RawLesson,
} from '../../../src/features/timetable/types.ts'

vi.mock('../../../src/features/timetable/nusmodsApi.ts', () => ({
  fetchModule: vi.fn(),
}))

const lesson: RawLesson = {
  classNo: '01',
  day: 'Monday',
  startTime: '1000',
  endTime: '1200',
  lessonType: 'Lecture',
  venue: 'LT1',
  weeks: [1, 2],
}
const module: NusmodsModule = {
  moduleCode: 'CS1010',
  title: 'Synthetic module',
  semesterData: [{ semester: 1, timetable: [lesson] }],
}

beforeEach(() => vi.mocked(fetchModule).mockReset().mockResolvedValue(module))

function resolve(configuration: string) {
  return resolveImportedTimetable(
    parseNusmodsShareLink(
      `https://nusmods.com/timetable/sem-1/share?CS1010=${configuration}`,
    ),
    '2026-2027',
  )
}

it.each(['LEC:01', 'LEC:(0)', 'LEC:(01|MON|1000|1200|LT1|1_2)'])(
  'imports a complete student lesson group from %s',
  async (configuration) => {
    const result = await resolve(configuration)
    expect(result.warnings).toEqual([])
    expect(result.selections).toEqual([
      {
        moduleCode: 'CS1010',
        moduleTitle: 'Synthetic module',
        lessonType: 'Lecture',
        classNo: '01',
      },
    ])
  },
)

it('rejects a wrapped lesson whose teaching weeks changed', async () => {
  const result = await resolve('LEC:(01|MON|1000|1200|LT1|9_10)')
  expect(result.selections).toEqual([])
  expect(result.warnings).toEqual([expect.stringContaining('Stale Lecture')])
})

it('rejects an incomplete wrapped class group', async () => {
  vi.mocked(fetchModule).mockResolvedValue({
    ...module,
    semesterData: [
      { semester: 1, timetable: [lesson, { ...lesson, day: 'Tuesday' }] },
    ],
  })
  const result = await resolve('LEC:(0)')
  expect(result.selections).toEqual([])
  expect(result.warnings).toEqual([expect.stringContaining('Stale Lecture')])
})
