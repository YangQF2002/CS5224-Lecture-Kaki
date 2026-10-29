import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import DiscoverPage from '../../../src/features/discovery/DiscoverPage.tsx'
import {
  fetchLectureSnapshot,
  fetchWeekSessions,
} from '../../../src/features/discovery/lectureApi.ts'
import type {
  LectureSession,
  LectureSnapshot,
} from '../../../src/features/discovery/types.ts'

vi.mock('../../../src/features/discovery/lectureApi.ts', () => ({
  fetchLectureSnapshot: vi.fn(),
  fetchWeekSessions: vi.fn(),
}))

const pointer = {
  generatedAt: '2026-10-26T09:05:19Z',
  acadYear: '2026-2027',
  semester: 1,
  path: 'lectures/2026-2027/sem-1/test/',
}

const snapshot: LectureSnapshot = {
  pointer,
  index: {
    generatedAt: pointer.generatedAt,
    acadYear: pointer.acadYear,
    semester: 1,
    sessionCount: 2,
    days: ['2026-10-27', '2026-10-28'],
    weeks: [
      {
        week: 'week-11',
        startDate: '2026-10-26',
        endDate: '2026-11-01',
        sessionCount: 2,
      },
    ],
  },
  modules: [
    {
      moduleCode: 'CS1010',
      title: 'Synthetic programming',
      faculty: 'Computing',
      department: 'Computer Science',
      level: 1000,
      moduleCredit: '4',
      description: 'Problem solving with machine learning examples.',
    },
    {
      moduleCode: 'LSM1301',
      title: 'Synthetic biology',
      faculty: 'Science',
      department: 'Biological Sciences',
      level: 1000,
      moduleCredit: '4',
      description: 'Cells and organisms.',
    },
  ],
}

const sessions: LectureSession[] = [
  {
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
  },
  {
    id: 'LSM1301-LEC-1@2026-10-28-1400-LT27',
    moduleCode: 'LSM1301',
    crossListed: [],
    moduleTitle: 'Synthetic biology',
    faculty: 'Science',
    department: 'Biological Sciences',
    level: 1000,
    lessonType: 'Lecture',
    classNo: '1',
    date: '2026-10-28',
    startTime: '14:00',
    endTime: '16:00',
    venue: 'LT27',
    building: 'S16',
    online: false,
    size: 300,
  },
]

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function renderPage(url = '/') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <DiscoverPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(fetchLectureSnapshot).mockReset().mockResolvedValue(snapshot)
  vi.mocked(fetchWeekSessions).mockReset().mockResolvedValue({
    week: 'week-11',
    startDate: '2026-10-26',
    endDate: '2026-11-01',
    sessions,
  })
})

afterEach(() => {
  cleanup()
})

it('lists the week’s lectures grouped by day', async () => {
  renderPage()

  expect(await screen.findByText('2 lectures in Week 11')).toBeTruthy()
  expect(
    screen.getByRole('heading', { name: /^Tuesday,? 27 October$/ }),
  ).toBeTruthy()
  expect(screen.getByText('COM1-0207')).toBeTruthy()
  expect(screen.getByText('LT27 · S16')).toBeTruthy()
  expect(fetchWeekSessions).toHaveBeenCalledWith(pointer, 'week-11')
})

it('filters by keywords in the description and records them in the URL', async () => {
  renderPage()
  await screen.findByText('2 lectures in Week 11')

  fireEvent.change(screen.getByLabelText('Keywords'), {
    target: { value: 'machine learning' },
  })

  expect(screen.getByText('1 lecture in Week 11')).toBeTruthy()
  expect(screen.getByText('Synthetic programming')).toBeTruthy()
  expect(screen.queryByText('Synthetic biology')).toBeNull()
  expect(screen.getByTestId('location').textContent).toBe('?q=machine+learning')
})

it('applies filters from a shared link', async () => {
  renderPage('/?buildings=S16&from=13:00')

  expect(await screen.findByText('1 lecture in Week 11')).toBeTruthy()
  expect(screen.getByText('Synthetic biology')).toBeTruthy()
})

it('filters by building with counts for the selected week', async () => {
  renderPage()
  await screen.findByText('2 lectures in Week 11')

  const buildings = screen.getByText('Buildings').closest('details')!
  fireEvent.click(within(buildings).getByLabelText(/COM1/))

  expect(screen.getByText('1 lecture in Week 11')).toBeTruthy()
  expect(screen.getByTestId('location').textContent).toBe('?buildings=COM1')
})

it('toggles days and clears filters while keeping the week', async () => {
  renderPage('/?q=biology')
  await screen.findByText('1 lecture in Week 11')

  fireEvent.click(screen.getByRole('button', { name: 'Wed 28' }))
  expect(screen.getByText('1 lecture in Week 11')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

  expect(screen.getByText('2 lectures in Week 11')).toBeTruthy()
  expect(screen.getByTestId('location').textContent).toBe('?week=week-11')
  expect((screen.getByLabelText('Keywords') as HTMLInputElement).value).toBe('')
})

it('explains when lecture data cannot be loaded', async () => {
  vi.mocked(fetchLectureSnapshot).mockRejectedValue(
    new Error('Lecture data returned HTTP 404'),
  )

  renderPage()

  expect(
    await screen.findByText(/Lecture data is unavailable right now/),
  ).toBeTruthy()
})
