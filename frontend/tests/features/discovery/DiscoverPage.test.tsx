import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'
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
import { fetchModule } from '../../../src/features/timetable/nusmodsApi.ts'
import {
  loadTimetable,
  saveTimetable,
} from '../../../src/features/timetable/timetableStorage.ts'
import {
  roomIdFor,
  roomPath,
} from '../../../src/features/forum/roomCatalogue.ts'

vi.mock(
  '../../../src/features/timetable/nusmodsApi.ts',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../../src/features/timetable/nusmodsApi.ts')
    >()),
    fetchModule: vi.fn(),
  }),
)
vi.mock('../../../src/features/timetable/timetableApi.ts', () => ({
  saveRemoteTimetable: vi.fn().mockResolvedValue(undefined),
}))

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
  return (
    <>
      <output data-testid="location">{location.search}</output>
      <Link to="/?q=biology">Browse biology</Link>
    </>
  )
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
  // Sunday before week 11 in Singapore: the fixture week is still open.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-25T02:00:00Z') })
  localStorage.clear()
  vi.mocked(fetchModule)
    .mockReset()
    .mockResolvedValue({
      moduleCode: 'CS5224',
      title: 'Cloud Computing',
      semesterData: [
        {
          semester: 1,
          timetable: [
            {
              classNo: '1',
              day: 'Tuesday',
              startTime: '1000',
              endTime: '1200',
              lessonType: 'Lecture',
              venue: 'LT19',
              weeks: [11],
            },
          ],
        },
      ],
    })
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
  vi.useRealTimers()
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

  fireEvent.change(screen.getByLabelText('Search modules'), {
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

  fireEvent.click(screen.getByText('Filters'))
  const buildings = screen
    .getByText('Buildings')
    .closest<HTMLElement>('.multi-select-field')!
  fireEvent.click(within(buildings).getByLabelText(/COM1/))

  expect(screen.getByText('1 lecture in Week 11')).toBeTruthy()
  expect(screen.getByTestId('location').textContent).toBe('?buildings=COM1')
})

it('ticks the first search match on Enter, then closes on Enter', async () => {
  renderPage()
  await screen.findByText('2 lectures in Week 11')

  fireEvent.click(screen.getByText('Filters'))
  const buildings = screen
    .getByText('Buildings')
    .closest<HTMLElement>('.multi-select-field')!
  const details = buildings.querySelector('details')!
  fireEvent.click(details.querySelector('summary')!)
  // <details> fires its toggle event asynchronously.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
  expect(details.open).toBe(true)

  const search = within(buildings).getByLabelText('Search buildings')
  fireEvent.change(search, { target: { value: 'com' } })
  fireEvent.keyDown(search, { key: 'Enter' })

  expect(screen.getByTestId('location').textContent).toBe('?buildings=COM1')
  expect((search as HTMLInputElement).value).toBe('com')
  expect(details.open).toBe(true)

  fireEvent.keyDown(search, { key: 'Enter' })
  expect(details.open).toBe(false)
  expect(screen.getByTestId('location').textContent).toBe('?buildings=COM1')
})

it('moves Tab from Faculties to Minimum class size, closing the list', async () => {
  renderPage()
  await screen.findByText('2 lectures in Week 11')

  fireEvent.click(screen.getByText('Filters'))
  const faculties = screen
    .getByText('Faculties')
    .closest<HTMLElement>('.multi-select-field')!
  const details = faculties.querySelector('details')!
  const summary = details.querySelector('summary')!
  const classSize = screen.getByLabelText('Minimum class size')

  summary.focus()
  fireEvent.keyDown(summary, { key: 'Tab' })
  expect(document.activeElement).toBe(classSize)

  fireEvent.click(summary)
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
  const search = within(faculties).getByLabelText('Search faculties')
  search.focus()
  fireEvent.keyDown(search, { key: 'Tab' })
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
  expect(document.activeElement).toBe(classSize)
  expect(details.open).toBe(false)

  summary.focus()
  fireEvent.keyDown(summary, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(
    screen
      .getByText('Subject codes')
      .closest('.multi-select-field')!
      .querySelector('summary'),
  )

  // Levels are skipped: Tab goes on to the "Only my topics" row.
  const myTopics = document.querySelector<HTMLElement>(
    '.my-topics input:not(:disabled), .my-topics a',
  )!
  fireEvent.keyDown(classSize, { key: 'Tab' })
  expect(document.activeElement).toBe(myTopics)

  // Clicking a checkbox focuses it (Safari doesn't), so Shift+Tab starts
  // there and steps back to Minimum class size.
  const online = screen.getByLabelText('Include online lectures')
  summary.focus()
  fireEvent.click(online)
  expect(document.activeElement).toBe(online)
  fireEvent.keyDown(online, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(myTopics)
  fireEvent.keyDown(myTopics, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(classSize)
  fireEvent.keyDown(classSize, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(summary)
})

it('toggles days and clears filters while keeping the week', async () => {
  renderPage('/?q=biology')
  await screen.findByText('1 lecture in Week 11')

  fireEvent.click(screen.getByRole('button', { name: 'Wed 28' }))
  expect(screen.getByText('1 lecture in Week 11')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

  expect(screen.getByText('2 lectures in Week 11')).toBeTruthy()
  expect(screen.getByTestId('location').textContent).toBe('?week=week-11')
  expect(
    (screen.getByLabelText('Search modules') as HTMLInputElement).value,
  ).toBe('')
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

it('links each lecture to the discussion for its actual session and term', async () => {
  renderPage()
  const discussion = await screen.findByRole('link', {
    name: 'Discuss CS1010 on 2026-10-27 at 10:00',
  })
  expect(discussion.getAttribute('href')).toBe(
    roomPath(roomIdFor(sessions[0], pointer)),
  )
})

it('does not list weeks that have ended, as in the Forum', async () => {
  vi.mocked(fetchLectureSnapshot).mockResolvedValue({
    ...snapshot,
    index: {
      ...snapshot.index,
      weeks: [
        {
          week: 'week-10',
          startDate: '2026-10-19',
          endDate: '2026-10-25',
          sessionCount: 1,
        },
        ...snapshot.index.weeks,
      ],
    },
  })
  vi.setSystemTime(new Date('2026-10-26T02:00:00Z')) // Monday of week 11.
  renderPage('/?week=week-10')
  await screen.findByText('2 lectures in Week 11')
  expect(fetchWeekSessions).not.toHaveBeenCalledWith(pointer, 'week-10')
})

it('keeps the search field in sync when another link changes the filters', async () => {
  renderPage('/?q=programming')
  await screen.findByText('1 lecture in Week 11')
  fireEvent.click(screen.getByRole('link', { name: 'Browse biology' }))
  expect(
    (screen.getByLabelText('Search modules') as HTMLInputElement).value,
  ).toBe('biology')
  expect(screen.getByText('Synthetic biology')).toBeTruthy()
  expect(screen.queryByText('Synthetic programming')).toBeNull()
})

function savedLecture() {
  saveTimetable({
    academicYear: '2026-2027',
    semester: 1,
    selections: [
      {
        moduleCode: 'CS5224',
        moduleTitle: 'Cloud Computing',
        lessonType: 'Lecture',
        classNo: '1',
      },
    ],
  })
}

it('checks real timetable overlaps before filtering clashes and preserves the filter in the URL', async () => {
  savedLecture()
  renderPage()
  const checkbox = await screen.findByRole<HTMLInputElement>('checkbox', {
    name: 'Hide clashes',
  })
  await waitFor(() => expect(checkbox.disabled).toBe(false))
  expect(screen.getByText('Clashes with your timetable')).toBeTruthy()
  fireEvent.click(checkbox)
  expect(screen.getByText('1 lecture in Week 11')).toBeTruthy()
  expect(screen.queryByText('Synthetic programming')).toBeNull()
  expect(screen.getByText('Synthetic biology')).toBeTruthy()
  expect(screen.getByTestId('location').textContent).toBe('?clashes=hide')
})

it('does not claim that lectures fit when timetable data cannot be loaded', async () => {
  savedLecture()
  vi.mocked(fetchModule).mockRejectedValue(new Error('Unavailable'))
  renderPage('/?clashes=hide')
  await screen.findAllByText('Timetable check unavailable')
  expect(screen.queryByText('Fits your timetable')).toBeNull()
  expect(screen.getByText('2 lectures in Week 11')).toBeTruthy()
  expect(
    screen.getByRole<HTMLInputElement>('checkbox', { name: 'Hide clashes' })
      .disabled,
  ).toBe(true)
})

it('adds and removes a discovered lecture using the card action', async () => {
  renderPage()
  const add = await screen.findByRole('button', {
    name: 'Add CS1010 to timetable',
  })
  fireEvent.click(add)
  expect(loadTimetable().selections).toEqual([
    expect.objectContaining({ moduleCode: 'CS1010', source: 'discover' }),
  ])
  expect(
    await screen.findByText('CS1010 added to your timetable.'),
  ).toBeTruthy()
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove CS1010 from timetable' }),
  )
  expect(loadTimetable().selections).toHaveLength(0)
  expect(screen.getByText('CS1010 removed from your timetable.')).toBeTruthy()
})
