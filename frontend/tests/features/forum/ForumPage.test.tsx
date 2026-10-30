import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ForumPage from '../../../src/features/forum/ForumPage.tsx'
import {
  ForumApiError,
  getCurrentUser,
  getMessages,
  postMessage,
  deleteMessage,
} from '../../../src/features/forum/forumApi.ts'
import {
  subscribeToRoom,
  type RoomEvent,
} from '../../../src/features/forum/forumSocket.ts'
import { SignInRequired } from '../../../src/features/forum/auth.ts'

vi.mock('../../../src/features/forum/auth.ts', async (original) => ({
  ...(await original<typeof import('../../../src/features/forum/auth.ts')>()),
  getAccessToken: vi.fn().mockResolvedValue('access-token'),
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

const room = 'BT1101-LEC-1@2026-10-20-0800-LT11@2026-2027@1'
const own = {
  message_id: '00000000000000000001-a',
  room_id: room,
  author_id: 'a',
  content: 'Hello lecture',
  posted_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
}
let onEvent: (event: RoomEvent) => void
let onReady: () => Promise<void>
const stop = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue({ user_id: 'a' })
  vi.mocked(getMessages).mockResolvedValue({ items: [own], next_cursor: null })
  vi.mocked(postMessage).mockResolvedValue(own)
  vi.mocked(deleteMessage).mockResolvedValue()
  vi.mocked(subscribeToRoom).mockImplementation(
    (_room, _getToken, handlers) => {
      onEvent = handlers.onEvent
      onReady = handlers.onReady
      handlers.onStatus('connected')
      return stop
    },
  )
})
afterEach(cleanup)
function page() {
  return render(
    <MemoryRouter initialEntries={[`/forum/${encodeURIComponent(room)}`]}>
      <Routes>
        <Route path="/forum/:roomId" element={<ForumPage />} />
      </Routes>
    </MemoryRouter>,
  )
}
it('shows own label and receives another student’s live message', async () => {
  page()
  await screen.findByText('You')
  act(() =>
    onEvent({
      type: 'message.created',
      room_id: room,
      message: {
        ...own,
        message_id: '00000000000000000002-b',
        author_id: 'b',
        content: 'Live reply',
      },
    }),
  )
  expect(screen.getByText('Live reply')).toBeTruthy()
  expect(screen.getByText('Student')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
})
it('deduplicates a POST response and its socket event', async () => {
  page()
  await screen.findByText('Hello lecture')
  fireEvent.change(screen.getByLabelText('Your message'), {
    target: { value: 'Hello lecture' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(postMessage).toHaveBeenCalledOnce())
  act(() => onEvent({ type: 'message.created', room_id: room, message: own }))
  expect(screen.getAllByText('Hello lecture')).toHaveLength(1)
})
it('removes deleted messages live and closes the subscription when leaving', async () => {
  const view = page()
  await screen.findByText('Hello lecture')
  act(() =>
    onEvent({
      type: 'message.deleted',
      room_id: room,
      message_id: own.message_id,
    }),
  )
  expect(screen.queryByText('Hello lecture')).toBeNull()
  view.unmount()
  expect(stop).toHaveBeenCalled()
})
it('offers real sign-in when there is no browser session', async () => {
  vi.mocked(getCurrentUser).mockRejectedValue(new SignInRequired())
  page()
  expect(
    await screen.findByRole('button', { name: 'Sign in with NUS email' }),
  ).toBeTruthy()
  expect(subscribeToRoom).not.toHaveBeenCalled()
})
it('keeps the draft after a failed send', async () => {
  vi.mocked(postMessage).mockRejectedValue(new Error('offline'))
  page()
  await screen.findByText('Hello lecture')
  fireEvent.change(screen.getByLabelText('Your message'), {
    target: { value: 'Keep my draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByRole('alert')
  expect(
    (screen.getByLabelText('Your message') as HTMLTextAreaElement).value,
  ).toBe('Keep my draft')
})

it('does not resurrect a deleted message when a history response arrives late', async () => {
  page()
  await screen.findByText('Hello lecture')
  let finish!: (page: { items: (typeof own)[]; next_cursor: null }) => void
  vi.mocked(getMessages).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const recovering = onReady()
  act(() =>
    onEvent({
      type: 'message.deleted',
      room_id: room,
      message_id: own.message_id,
    }),
  )
  await act(async () => {
    finish({ items: [own], next_cursor: null })
    await recovering
  })
  expect(screen.queryByText('Hello lecture')).toBeNull()
})

it('stops claiming a live connection is connecting after history fails, and recovers on retry', async () => {
  vi.mocked(getMessages).mockRejectedValueOnce(new ForumApiError(422))
  page()
  await screen.findByText('This room ID is invalid. Check the lecture link.')
  expect(screen.getByRole('status').textContent).toContain('unavailable')
  expect(subscribeToRoom).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('Hello lecture')
  expect(screen.getByRole('status').textContent).toContain('connected')
})

it('keeps newer history when an older reconnect request finishes last', async () => {
  page()
  await screen.findByText('Hello lecture')
  let finish!: (value: { items: (typeof own)[]; next_cursor: null }) => void
  vi.mocked(getMessages).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const older = onReady()
  const latest = {
    ...own,
    message_id: '00000000000000000002-b',
    content: 'Newer history',
  }
  vi.mocked(getMessages).mockResolvedValueOnce({
    items: [own, latest],
    next_cursor: null,
  })
  await act(async () => {
    await onReady()
  })
  expect(screen.getByText('Newer history')).toBeTruthy()
  await act(async () => {
    finish({ items: [own], next_cursor: null })
    await older
  })
  expect(screen.getByText('Newer history')).toBeTruthy()
})

it('ignores an older-page response overtaken by a history refresh', async () => {
  vi.mocked(getMessages).mockResolvedValueOnce({
    items: [own],
    next_cursor: 'older-page',
  })
  page()
  await screen.findByText('Hello lecture')
  let finish!: (value: { items: (typeof own)[]; next_cursor: null }) => void
  vi.mocked(getMessages).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Load older messages' }))
  await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2))
  await act(async () => {
    await onReady()
  })
  await act(async () => {
    finish({
      items: [
        {
          ...own,
          message_id: '00000000000000000000-old',
          content: 'Stale older page',
        },
      ],
      next_cursor: null,
    })
  })
  expect(screen.queryByText('Stale older page')).toBeNull()
})
