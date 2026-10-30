// prettier-ignore
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../../src/App.tsx'
import * as lectureApi from '../../../src/features/discovery/lectureApi.ts'
// prettier-ignore
import type { LectureSession, LectureSnapshot } from '../../../src/features/discovery/types.ts'
import * as forumApi from '../../../src/features/forum/forumApi.ts'
import ForumHome from '../../../src/features/forum/ForumHome.tsx'
import ForumPage from '../../../src/features/forum/ForumPage.tsx'
// prettier-ignore
import { subscribeToRoom, type RoomEvent } from '../../../src/features/forum/forumSocket.ts'
import { roomPath } from '../../../src/features/forum/roomCatalogue.ts'

vi.mock('../../../src/features/discovery/lectureApi.ts', () => ({
  fetchLectureSnapshot: vi.fn(),
  fetchWeekSessions: vi.fn(),
}))
vi.mock('../../../src/features/forum/forumApi.ts', async (original) => ({
  ...(await original<
    typeof import('../../../src/features/forum/forumApi.ts')
  >()),
  getCurrentUser: vi.fn(),
  getMessages: vi.fn(),
  postMessage: vi.fn(),
  deleteMessage: vi.fn(),
}))
vi.mock('../../../src/features/forum/forumSocket.ts', () => ({
  subscribeToRoom: vi.fn(),
}))

const api = vi.mocked(forumApi)
const lectures = vi.mocked(lectureApi)

const lecture: LectureSession = {
  id: 'BT1101-LEC-01@2026-10-20-0800-LT11',
  moduleCode: 'BT1101',
  moduleTitle: 'Business Analytics',
  crossListed: [],
  faculty: 'Computing',
  department: 'Computing',
  level: 1000,
  lessonType: 'Lecture',
  classNo: '01',
  date: '2026-10-20',
  startTime: '08:00',
  endTime: '10:00',
  venue: 'LT11',
  building: null,
  online: false,
  size: 100,
}
const laterLecture: LectureSession = {
  ...lecture,
  id: 'CS5224-LEC-01@2026-10-27-0800-LT11',
  moduleCode: 'CS5224',
  moduleTitle: 'Cloud Computing',
  date: '2026-10-27',
}
const pointer = {
  generatedAt: '2026-10-19T00:00:00Z',
  acadYear: '2026-2027',
  semester: 1,
  path: 'lectures/2026-2027/sem-1/test/',
}
const weeks = [
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
const snapshot: LectureSnapshot = {
  pointer,
  index: {
    ...pointer,
    sessionCount: 2,
    days: [lecture.date, laterLecture.date],
    weeks,
  },
  modules: [],
}
const roomId = `${lecture.id}@2026-2027@1`
const own = {
  message_id: '00000000000000000001-a',
  room_id: roomId,
  author_id: 'student-a',
  content: 'Hello lecture',
  posted_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
}
let receive: (event: RoomEvent) => void
function emit(event: RoomEvent) {
  act(() => receive(event))
}
function messageBox() {
  return screen.getByLabelText<HTMLTextAreaElement>('Your message')
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}
function renderForum(url = roomPath(roomId)) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<App />}>
          <Route path="forum" element={<ForumHome />} />
          <Route path="forum/:roomId" element={<ForumPage />} />
          <Route path="timetable" element={<h1>My timetable</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  document.cookie = 'lecturekaki:login-hint:v1=; Max-Age=0; Path=/'
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  lectures.fetchLectureSnapshot.mockResolvedValue(snapshot)
  lectures.fetchWeekSessions.mockImplementation(async (_pointer, week) => ({
    ...weeks.find((item) => item.week === week)!,
    sessions: [week === 'week-10' ? lecture : laterLecture],
  }))
  api.getCurrentUser.mockResolvedValue({ user_id: own.author_id })
  api.getMessages.mockResolvedValue({
    items: [own],
    next_cursor: null,
  })
  api.deleteMessage.mockResolvedValue()
  vi.mocked(subscribeToRoom).mockImplementation((_room, _token, handlers) => {
    receive = handlers.onEvent
    handlers.onStatus('connected')
    return vi.fn()
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('loads history, delivers live replies and posts/deletes owned messages', async () => {
  const message = { ...own, message_id: '2-a', content: 'New question' }
  api.postMessage.mockResolvedValueOnce(message)
  renderForum()
  await screen.findByText(own.content)
  emit({
    type: 'message.created',
    room_id: roomId,
    message: {
      ...own,
      message_id: '2-b',
      author_id: 'student-b',
      content: 'Live reply',
    },
  })
  expect(screen.getByText('Live reply')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
  change('Your message', message.content)
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText(message.content)
  emit({ type: 'message.created', room_id: roomId, message })
  expect(screen.getAllByText(message.content)).toHaveLength(1)
  expect(api.postMessage).toHaveBeenCalledOnce()
  expect(messageBox().value).toBe('')
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
  await waitFor(() => expect(screen.queryByText(own.content)).toBeNull())
  expect(api.deleteMessage).toHaveBeenCalledOnce()
})
it('returns to the selected room and draft after visiting Timetable', async () => {
  renderForum()
  await screen.findByLabelText('Your message')
  change('Your message', 'My unsent question')
  fireEvent.click(screen.getByRole('link', { name: 'My timetable' }))
  await screen.findByRole('heading', { name: 'My timetable' })
  fireEvent.click(screen.getByRole('link', { name: 'Forum' }))
  expect(
    (await screen.findByLabelText<HTMLTextAreaElement>('Your message')).value,
  ).toBe('My unsent question')
})
it('returns to the picker with its filters when that was the last Forum screen', async () => {
  renderForum()
  fireEvent.click(
    await screen.findByRole('link', { name: 'Choose another lecture' }),
  )
  await screen.findByRole('option', { name: /Week 11/ })
  change('Week', 'week-11')
  change('Find a lecture', 'CS5224')
  await screen.findByText(laterLecture.moduleTitle)
  fireEvent.click(screen.getByRole('link', { name: 'My timetable' }))
  await screen.findByRole('heading', { name: 'My timetable' })
  fireEvent.click(screen.getByRole('link', { name: 'Forum' }))
  await screen.findByRole('heading', { name: 'Lecture Forum' })
  expect(screen.getByLabelText<HTMLSelectElement>('Week').value).toBe('week-11')
  expect(screen.getByLabelText<HTMLInputElement>('Find a lecture').value).toBe(
    'CS5224',
  )
  expect(screen.queryByLabelText('Your message')).toBeNull()
  fireEvent.click(await screen.findByRole('link', { name: /Join CS5224/ }))
  expect(
    await screen.findByRole('heading', { name: 'CS5224 discussion' }),
  ).toBeTruthy()
})

it('clears protected content when another tab signs out', async () => {
  renderForum()
  await screen.findByText('Hello lecture')
  act(() => {
    localStorage.setItem('lecturekaki:sign-out:v1', 'signed-out')
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'lecturekaki:sign-out:v1' }),
    )
  })
  expect(screen.queryByText('Hello lecture')).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Sign in with NUS email' }),
  ).toBeTruthy()
})
it('rejects an unpublished room before accessing the Forum API', async () => {
  renderForum(roomPath(roomId.replace('-01@', '-99@')))
  expect(
    await screen.findByRole('heading', { name: 'Discussion unavailable' }),
  ).toBeTruthy()
  expect(api.getCurrentUser).not.toHaveBeenCalled()
})
