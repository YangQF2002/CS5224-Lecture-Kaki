// prettier-ignore
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../../src/App.tsx'
import * as lectureApi from '../../../src/features/discovery/lectureApi.ts'
// prettier-ignore
import type { LectureSession, LectureSnapshot } from '../../../src/features/discovery/types.ts'
import * as forumApi from '../../../src/features/forum/forumApi.ts'
import * as pdfApi from '../../../src/features/forum/forumPdf.ts'
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

vi.mock('../../../src/features/forum/forumPdf.ts', async (original) => ({
  ...(await original<
    typeof import('../../../src/features/forum/forumPdf.ts')
  >()),
  uploadPdf: vi.fn(),
  downloadPdf: vi.fn(),
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
  ['week-10', '2026-10-19', '2026-10-25'],
  ['week-11', '2026-10-26', '2026-11-01'],
].map(([week, startDate, endDate]) => ({
  week,
  startDate,
  endDate,
  sessionCount: 1,
}))
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
function reply(message: forumApi.MessageOut) {
  act(() => receive({ type: 'message.created', room_id: roomId, message }))
}
const messageBox = () =>
  screen.getByLabelText<HTMLTextAreaElement>('Your message')
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}
async function chooseWeek(label: RegExp) {
  const trigger = screen.getByRole('combobox', { name: 'Week' })
  await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false))
  fireEvent.keyDown(trigger, { key: 'ArrowDown', code: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: label }))
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
  vi.mocked(pdfApi.uploadPdf).mockReset()
  vi.mocked(pdfApi.downloadPdf).mockReset()
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
  api.getMessages.mockResolvedValue({ items: [own], next_cursor: null })
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
  reply({
    ...own,
    message_id: '2-b',
    author_id: 'student-b',
    content: 'Live reply',
  })
  expect(screen.getByText('Live reply')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
  change('Your message', message.content)
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText(message.content)
  reply(message)
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
  fireEvent.click(screen.getByRole('link', { name: /My timetable/i }))
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
  await chooseWeek(/Week 11/)
  change('Find a lecture', 'CS5224')
  await screen.findByText(laterLecture.moduleTitle)
  fireEvent.click(screen.getByRole('link', { name: /My timetable/i }))
  await screen.findByRole('heading', { name: 'My timetable' })
  fireEvent.click(screen.getByRole('link', { name: 'Forum' }))
  await screen.findByRole('heading', { name: 'Lecture Forum' })
  expect(screen.getByRole('combobox', { name: 'Week' }).textContent).toContain(
    'Week 11',
  )
  expect(screen.getByLabelText<HTMLInputElement>('Find a lecture').value).toBe(
    'CS5224',
  )
  expect(screen.queryByLabelText('Your message')).toBeNull()
  fireEvent.click(await screen.findByRole('link', { name: /Join CS5224/ }))
  expect(
    await screen.findByRole('heading', { name: 'CS5224 discussion' }),
  ).toBeTruthy()
})

it('opens shared links from the picker and another room while preserving drafts', async () => {
  renderForum('/forum?browse=1&week=week-10')
  await screen.findByRole('heading', { name: 'Lecture Forum' })
  const panel = screen.getByRole('complementary', {
    name: 'Have a shared discussion link?',
  })
  expect(
    panel.contains(screen.getByLabelText('Discussion link or room ID')),
  ).toBe(true)
  change('Discussion link or room ID', 'invalid-room')
  fireEvent.click(screen.getByRole('button', { name: 'Open discussion' }))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Enter a valid Forum discussion link or room ID.',
  )
  expect(api.getCurrentUser).not.toHaveBeenCalled()
  change('Discussion link or room ID', `${location.origin}${roomPath(roomId)}`)
  fireEvent.click(screen.getByRole('button', { name: 'Open discussion' }))
  await screen.findByLabelText('Your message')
  change('Your message', 'Keep my question for this room')
  change('Discussion link or room ID', `${laterLecture.id}@2026-2027@1`)
  fireEvent.click(screen.getByRole('button', { name: 'Open discussion' }))
  await screen.findByRole('heading', { name: 'CS5224 discussion' })
  expect(messageBox().value).toBe('')
  change('Discussion link or room ID', roomId)
  fireEvent.click(screen.getByRole('button', { name: 'Open discussion' }))
  await screen.findByRole('heading', { name: 'BT1101 discussion' })
  expect(messageBox().value).toBe('Keep my question for this room')
})

it.each(['LT11', 'COM1-02/01.1'])(
  'opens the exact copied link for a %s venue and confirms an already-open room',
  async (venue) => {
    const selected = {
      ...lecture,
      venue,
      id: lecture.id.replace('LT11', venue),
    }
    const selectedId = `${selected.id}@2026-2027@1`
    lectures.fetchWeekSessions.mockResolvedValue({
      ...weeks[0],
      sessions: [selected],
    })
    let copiedLink = ''
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async (value: string) => {
          copiedLink = value
        }),
      },
    })
    try {
      renderForum(roomPath(selectedId))
      fireEvent.click(
        await screen.findByRole('button', { name: 'Copy discussion link' }),
      )
      await screen.findByText('Discussion link copied.')
      expect(copiedLink).toBe(`${location.origin}${roomPath(selectedId)}`)
      fireEvent.click(
        screen.getByRole('link', { name: 'Choose another lecture' }),
      )
      await screen.findByRole('heading', { name: 'Lecture Forum' })
      change('Discussion link or room ID', copiedLink)
      fireEvent.click(screen.getByRole('button', { name: 'Open discussion' }))
      await screen.findByRole('heading', { name: 'BT1101 discussion' })
      await waitFor(() => expect(messageBox().disabled).toBe(false))
      expect(api.getMessages).toHaveBeenLastCalledWith(
        selectedId,
        expect.any(Function),
      )
      change('Your message', 'Keep this draft when reopening the current link')
      change('Discussion link or room ID', copiedLink)
      fireEvent.click(screen.getByRole('button', { name: 'Open discussion' }))
      await screen.findByText('This discussion is already open.')
      expect(messageBox().value).toBe(
        'Keep this draft when reopening the current link',
      )
      change('Discussion link or room ID', 'invalid-room')
      expect(screen.queryByText('This discussion is already open.')).toBeNull()
    } finally {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  },
)

it.each(['lecture details', 'message history'])(
  'retries a shared link after %s temporarily fail to load',
  async (failure) => {
    if (failure === 'lecture details') {
      lectures.fetchLectureSnapshot.mockRejectedValueOnce(
        new Error('Temporary lecture data failure'),
      )
    } else {
      api.getMessages.mockRejectedValueOnce(new forumApi.ForumApiError(503))
    }
    renderForum()
    await screen.findByRole('alert')
    if (failure === 'lecture details')
      expect(api.getCurrentUser).not.toHaveBeenCalled()
    change(
      'Discussion link or room ID',
      `${location.origin}${roomPath(roomId)}`,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open discussion' }))
    await screen.findByRole('heading', { name: 'BT1101 discussion' })
    await waitFor(() => expect(messageBox().disabled).toBe(false))
    expect(
      failure === 'lecture details'
        ? lectures.fetchLectureSnapshot
        : api.getMessages,
    ).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('This discussion is already open.')).toBeNull()
  },
)

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

it('posts PDF-only messages and offers authenticated downloads', async () => {
  const file = new File(['%PDF-example'], 'lecture.pdf', {
    type: 'application/pdf',
  })
  const message = {
    ...own,
    content: '',
    message_id: '3-pdf',
    attachment: { filename: file.name, size: file.size },
  }
  vi.mocked(pdfApi.uploadPdf).mockResolvedValueOnce('pdf-upload-id')
  vi.mocked(pdfApi.downloadPdf).mockResolvedValueOnce(undefined)
  api.postMessage.mockResolvedValueOnce(message)
  renderForum()
  await screen.findByLabelText('Your message')
  await waitFor(() => expect(messageBox().disabled).toBe(false))
  const input = screen.getByLabelText<HTMLInputElement>('PDF file')
  expect(input.hidden).toBe(true)
  const openPicker = vi.spyOn(input, 'click')
  fireEvent.click(screen.getByRole('button', { name: 'Attach a PDF' }))
  expect(openPicker).toHaveBeenCalledOnce()
  fireEvent.change(input, { target: { files: [file] } })
  expect(screen.getByText(file.name)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove PDF' }))
  expect(screen.queryByRole('button', { name: 'Remove PDF' })).toBeNull()
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled,
  ).toBe(true)
  fireEvent.change(input, { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  const download = await screen.findByRole('button', {
    name: /Download PDF: lecture.pdf/,
  })
  expect(api.postMessage).toHaveBeenCalledWith(
    roomId,
    '',
    expect.any(Function),
    'pdf-upload-id',
    vi.mocked(pdfApi.uploadPdf).mock.calls[0][3],
  )
  expect(screen.getByText(file.name)).toBeTruthy()
  reply(message)
  expect(
    screen.getAllByRole('button', { name: /Download PDF: lecture.pdf/ }),
  ).toHaveLength(1)
  fireEvent.click(download)
  await waitFor(() => expect(pdfApi.downloadPdf).toHaveBeenCalledOnce())
  expect(screen.queryByRole('button', { name: 'Remove PDF' })).toBeNull()
})

it('blocks invalid PDFs before uploading and keeps the text draft', async () => {
  renderForum()
  await screen.findByLabelText('Your message')
  change('Your message', 'Keep this question')
  const input = screen.getByLabelText('PDF file')
  fireEvent.change(input, {
    target: { files: [new File(['bad'], 'file.exe')] },
  })
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Choose a PDF file.',
  )
  const large = new File(['pdf'], 'large.pdf', { type: 'application/pdf' })
  Object.defineProperty(large, 'size', { value: 15 * 1024 * 1024 + 1 })
  fireEvent.change(input, { target: { files: [large] } })
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Choose a non-empty PDF up to 15 MB.',
  )
  expect(messageBox().value).toBe('Keep this question')
  expect(pdfApi.uploadPdf).not.toHaveBeenCalled()
})

it.each(['signs out', 'leaves the room'])(
  'does not post an in-flight PDF after the user %s',
  async (action) => {
    let complete!: (id: string) => void
    vi.mocked(pdfApi.uploadPdf).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    renderForum()
    await screen.findByLabelText('Your message')
    change('Your message', 'Keep this draft')
    fireEvent.change(screen.getByLabelText('PDF file'), {
      target: {
        files: [new File(['pdf'], 'lecture.pdf', { type: 'application/pdf' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(pdfApi.uploadPdf).toHaveBeenCalledOnce())
    if (action === 'signs out') {
      act(() =>
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'lecturekaki:sign-out:v1' }),
        ),
      )
    } else {
      fireEvent.click(screen.getByRole('link', { name: /My timetable/i }))
      await screen.findByRole('heading', { name: 'My timetable' })
    }
    expect(vi.mocked(pdfApi.uploadPdf).mock.calls[0][3].aborted).toBe(true)
    await act(async () => complete('late-upload'))
    expect(api.postMessage).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Download PDF/ })).toBeNull()
    if (action === 'leaves the room') {
      fireEvent.click(screen.getByRole('link', { name: 'Forum' }))
      expect(
        (await screen.findByLabelText<HTMLTextAreaElement>('Your message'))
          .value,
      ).toBe('Keep this draft')
      expect(screen.queryByRole('button', { name: 'Remove PDF' })).toBeNull()
    }
  },
)
