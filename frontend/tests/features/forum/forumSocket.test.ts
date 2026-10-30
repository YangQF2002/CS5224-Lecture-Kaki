import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  ForumApiError,
  getConnectionTicket,
} from '../../../src/features/forum/forumApi.ts'
import { subscribeToRoom } from '../../../src/features/forum/forumSocket.ts'
vi.mock('../../../src/features/forum/forumApi.ts', async (original) => ({
  ...(await original<
    typeof import('../../../src/features/forum/forumApi.ts')
  >()),
  getConnectionTicket: vi.fn(),
}))
class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  url: string
  readyState = 1
  onopen?: () => void
  onclose?: () => void
  onmessage?: (event: { data: string }) => void
  onerror?: () => void
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 3
    this.onclose?.()
  })
  constructor(url: string) {
    this.url = url
    Socket.instances.push(this)
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  vi.mocked(getConnectionTicket).mockResolvedValue({
    path: '/rooms/room-a/live?ticket=one',
    session_expires_at: Date.now() / 1000 + 900,
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function handlers() {
  return {
    onEvent: vi.fn(),
    onStatus: vi.fn(),
    onReady: vi.fn().mockResolvedValue(undefined),
    onUnauthorized: vi.fn(),
  }
}
it('buffers room events until history sync completes, then reconnects with a fresh ticket', async () => {
  const h = handlers()
  let finish!: () => void
  h.onReady.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve
    }),
  )
  const stop = subscribeToRoom('room-a', async () => 'token', h)
  await vi.advanceTimersByTimeAsync(0)
  const socket = Socket.instances[0]
  socket.onopen?.()
  socket.onmessage?.({
    data: JSON.stringify({
      type: 'message.deleted',
      room_id: 'room-a',
      message_id: 'm1',
    }),
  })
  socket.onmessage?.({
    data: JSON.stringify({
      type: 'message.deleted',
      room_id: 'room-b',
      message_id: 'm2',
    }),
  })
  expect(h.onEvent).not.toHaveBeenCalled()
  finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.onEvent).toHaveBeenCalledOnce()
  socket.close()
  await vi.advanceTimersByTimeAsync(1000)
  expect(getConnectionTicket).toHaveBeenCalledTimes(2)
  stop()
})
it('requests sign-in after a 401 instead of retrying forever', async () => {
  vi.mocked(getConnectionTicket).mockRejectedValue(new ForumApiError(401))
  const h = handlers()
  const stop = subscribeToRoom('room-a', async () => 'token', h)
  await vi.advanceTimersByTimeAsync(60000)
  expect(h.onUnauthorized).toHaveBeenCalledOnce()
  expect(getConnectionTicket).toHaveBeenCalledOnce()
  stop()
})
it('does not connect after its component has left the room', async () => {
  let finish!: (ticket: { path: string; session_expires_at: number }) => void
  vi.mocked(getConnectionTicket).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const stop = subscribeToRoom('room-a', async () => 'token', handlers())
  stop()
  finish({
    path: '/rooms/room-a/live?ticket=two',
    session_expires_at: Date.now() / 1000 + 900,
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(Socket.instances).toHaveLength(0)
})

it('recovers automatically after a temporary ticket service failure', async () => {
  vi.mocked(getConnectionTicket).mockRejectedValueOnce(new ForumApiError(503))
  const h = handlers()
  const stop = subscribeToRoom('room-a', async () => 'token', h)
  await vi.advanceTimersByTimeAsync(0)
  expect(Socket.instances).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(getConnectionTicket).toHaveBeenCalledTimes(2)
  expect(Socket.instances).toHaveLength(1)
  Socket.instances[0].onopen?.()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.onStatus).toHaveBeenLastCalledWith('connected')
  stop()
})

it('does not sync history or leave timers behind when a stopped socket opens late', async () => {
  const h = handlers()
  const stop = subscribeToRoom('room-a', async () => 'token', h)
  await vi.advanceTimersByTimeAsync(0)
  const socket = Socket.instances[0]
  stop()
  socket.onopen?.()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.onReady).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('requests sign-in when history recovery rejects authentication', async () => {
  const h = handlers()
  h.onReady.mockRejectedValue(new ForumApiError(401))
  const stop = subscribeToRoom('room-a', async () => 'token', h)
  await vi.advanceTimersByTimeAsync(0)
  Socket.instances[0].onopen?.()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.onUnauthorized).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(getConnectionTicket).toHaveBeenCalledOnce()
  stop()
})

it('backs off repeated history failures instead of retrying every second', async () => {
  const h = handlers()
  h.onReady.mockRejectedValue(new Error('history temporarily unavailable'))
  const stop = subscribeToRoom('room-a', async () => 'token', h)
  await vi.advanceTimersByTimeAsync(0)
  Socket.instances[0].onopen?.()
  await vi.advanceTimersByTimeAsync(1000)
  expect(getConnectionTicket).toHaveBeenCalledTimes(2)
  Socket.instances[1].onopen?.()
  await vi.advanceTimersByTimeAsync(1000)
  expect(getConnectionTicket).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1000)
  expect(getConnectionTicket).toHaveBeenCalledTimes(3)
  stop()
})
