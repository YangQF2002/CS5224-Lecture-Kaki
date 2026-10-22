import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TimetablePage from './TimetablePage.tsx'
import { fetchModule, fetchModuleList } from './nusmodsApi.ts'
import type { NusmodsModule, TimetableState } from './types.ts'

vi.mock('./nusmodsApi.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./nusmodsApi.ts')>()),
  fetchModule: vi.fn(),
  fetchModuleList: vi.fn(),
}))

const STORAGE_KEY = 'lecture-kaki:timetable:v1'
const module: NusmodsModule = {
  moduleCode: 'CS1010',
  title: 'Synthetic module',
  semesterData: [
    {
      semester: 1,
      timetable: [
        {
          classNo: '1',
          day: 'Monday',
          startTime: '1000',
          endTime: '1200',
          lessonType: 'Lecture',
          venue: 'LT1',
          weeks: [1, 2],
        },
        {
          classNo: '01',
          day: 'Tuesday',
          startTime: '1000',
          endTime: '1100',
          lessonType: 'Tutorial',
          venue: 'TR1',
          weeks: [1, 2],
        },
      ],
    },
    { semester: 2, timetable: [] },
  ],
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ academicYear: '2026-2027', semester: 1, selections: [] }),
  )
  vi.mocked(fetchModule).mockReset().mockResolvedValue(module)
  vi.mocked(fetchModuleList)
    .mockReset()
    .mockResolvedValue([
      { moduleCode: module.moduleCode, title: module.title, semesters: [1, 2] },
    ])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function chooseModule() {
  fireEvent.change(
    screen.getByPlaceholderText('Search by module code or title'),
    { target: { value: 'CS1010' } },
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'CS1010 Synthetic module' }),
  )
  await screen.findByRole('combobox', { name: 'Lecture' })
}

function selectedModules() {
  return within(
    screen.getByRole('heading', { name: 'Selected modules' }).parentElement!,
  )
}

it('adds a tutorial without removing the existing lecture', async () => {
  render(<TimetablePage />)
  await chooseModule()
  fireEvent.change(screen.getByRole('combobox', { name: 'Lecture' }), {
    target: { value: '1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add selected groups' }))
  await chooseModule()
  fireEvent.change(screen.getByRole('combobox', { name: 'Tutorial' }), {
    target: { value: '01' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add selected groups' }))
  expect(selectedModules().getByText('Lecture: 1')).toBeTruthy()
  expect(selectedModules().getByText('Tutorial: 01')).toBeTruthy()
})

it('restores an added lesson group after remounting', async () => {
  const page = render(<TimetablePage />)
  await chooseModule()
  fireEvent.change(screen.getByRole('combobox', { name: 'Lecture' }), {
    target: { value: '1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add selected groups' }))

  page.unmount()
  render(<TimetablePage />)

  expect(selectedModules().getByText('Lecture: 1')).toBeTruthy()
})

it('shows available lessons when a selected module fails and clears the warning after removal', async () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      academicYear: '2026-2027',
      semester: 1,
      selections: ['CS1010', 'CS2040'].map((moduleCode) => ({
        moduleCode,
        moduleTitle: module.title,
        lessonType: 'Lecture',
        classNo: '1',
      })),
    }),
  )
  vi.mocked(fetchModule).mockImplementation(async (_year, moduleCode) => {
    if (moduleCode === 'CS2040') throw new Error('NUSMods returned HTTP 404')
    return module
  })
  render(<TimetablePage />)

  await screen.findByText('Unable to load timetable for: CS2040.')
  const schedule = within(
    screen.getByRole('heading', { name: 'Weekly schedule' }).parentElement!,
  )
  const lessons = schedule.getAllByRole('article')
  expect(lessons).toHaveLength(1)
  expect(within(lessons[0]).getByText('CS1010')).toBeTruthy()

  const failedModule = selectedModules()
    .getByText('CS2040')
    .closest<HTMLElement>('.selected-module')!
  fireEvent.click(within(failedModule).getByRole('button', { name: 'Remove' }))
  await waitFor(() =>
    expect(
      screen.queryByText('Unable to load timetable for: CS2040.'),
    ).toBeNull(),
  )
})

it('clears the picker when the semester changes', async () => {
  render(<TimetablePage />)
  await chooseModule()
  fireEvent.change(screen.getByRole('combobox', { name: 'Lecture' }), {
    target: { value: '1' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Semester' }), {
    target: { value: '2' },
  })
  expect(
    screen.queryByRole('button', { name: 'Add selected groups' }),
  ).toBeNull()
})

it('ignores a module response started before the semester changed', async () => {
  let resolveModule!: (module: NusmodsModule) => void
  vi.mocked(fetchModule).mockReturnValue(
    new Promise((resolve) => {
      resolveModule = resolve
    }),
  )
  render(<TimetablePage />)
  fireEvent.change(
    screen.getByPlaceholderText('Search by module code or title'),
    { target: { value: 'CS1010' } },
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'CS1010 Synthetic module' }),
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'Semester' }), {
    target: { value: '2' },
  })
  await act(async () => resolveModule(module))
  expect(
    screen.queryByRole('button', { name: 'Add selected groups' }),
  ).toBeNull()
})

it('does not overwrite a new term with a delayed import', async () => {
  let resolveModule!: (module: NusmodsModule) => void
  vi.mocked(fetchModule).mockReturnValue(
    new Promise((resolve) => {
      resolveModule = resolve
    }),
  )
  render(<TimetablePage />)
  fireEvent.change(
    screen.getByPlaceholderText('Paste a NUSMods timetable share link'),
    {
      target: {
        value: 'https://nusmods.com/timetable/sem-1/share?CS1010=LEC:1',
      },
    },
  )
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Semester' }), {
    target: { value: '2' },
  })
  await act(async () => resolveModule(module))
  expect(
    (screen.getByRole('combobox', { name: 'Semester' }) as HTMLSelectElement)
      .value,
  ).toBe('2')
  expect(selectedModules().getByText('No modules added yet.')).toBeTruthy()
})

it.each([
  'null',
  '{"academicYear":"2026-2027","semester":1,"selections":null}',
])('recovers invalid saved state: %s', (stored) => {
  localStorage.setItem(STORAGE_KEY, stored)
  render(<TimetablePage />)
  expect(screen.getByText('No modules added yet.')).toBeTruthy()
})

it('falls back to an empty timetable when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage denied')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage denied')
  })
  render(<TimetablePage />)
  expect(screen.getByText('No modules added yet.')).toBeTruthy()
})

it('does not clear a saved timetable or fetch incomplete years while editing the year', async () => {
  const initial: TimetableState = {
    academicYear: '2026-2027',
    semester: 1,
    selections: [
      {
        moduleCode: 'CS1010',
        moduleTitle: module.title,
        lessonType: 'Lecture',
        classNo: '1',
      },
    ],
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
  render(<TimetablePage />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Academic year' }), {
    target: { value: '202' },
  })
  fireEvent.blur(screen.getByRole('textbox', { name: 'Academic year' }))
  await waitFor(() =>
    expect(selectedModules().getByText('Lecture: 1')).toBeTruthy(),
  )
  expect(
    vi
      .mocked(fetchModuleList)
      .mock.calls.every(([year]) => year === '2026-2027'),
  ).toBe(true)
})
