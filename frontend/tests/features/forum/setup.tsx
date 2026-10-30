import { act, cleanup, render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, vi } from 'vitest'
import App from '../../../src/App.tsx'
import {
  fetchLectureSnapshot,
  fetchWeekSessions,
} from '../../../src/features/discovery/lectureApi.ts'
import {
  deleteMessage,
  getCurrentUser,
  getMessages,
  postMessage,
} from '../../../src/features/forum/forumApi.ts'
import ForumHome from '../../../src/features/forum/ForumHome.tsx'
import ForumPage from '../../../src/features/forum/ForumPage.tsx'
import {
  subscribeToRoom,
  type RoomEvent,
} from '../../../src/features/forum/forumSocket.ts'
import { roomPath } from '../../../src/features/forum/roomCatalogue.ts'
import { roomId, snapshot, weekData } from './fixtures.ts'

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

export const api = {
  user: vi.mocked(getCurrentUser),
  history: vi.mocked(getMessages),
  post: vi.mocked(postMessage),
  delete: vi.mocked(deleteMessage),
}
export const own = {
  message_id: '00000000000000000001-a',
  room_id: roomId,
  author_id: 'student-a',
  content: 'Hello lecture',
  posted_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
}
let receive: (event: RoomEvent) => void
export function emit(event: RoomEvent) {
  act(() => receive(event))
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  document.cookie = 'lecturekaki:login-hint:v1=; Max-Age=0; Path=/'
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.mocked(fetchLectureSnapshot).mockResolvedValue(snapshot)
  vi.mocked(fetchWeekSessions).mockImplementation((_pointer, week) =>
    Promise.resolve(weekData(week)),
  )
  api.user.mockResolvedValue({ user_id: own.author_id })
  api.history.mockResolvedValue({ items: [own], next_cursor: null })
  api.post.mockResolvedValue(own)
  api.delete.mockResolvedValue()
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

export function renderForum(url = roomPath(roomId)) {
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
