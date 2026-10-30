import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// prettier-ignore
import { completeSignIn, getAccessToken, SignInRequired, signOut, startSignIn, tryAutomaticSignIn } from '../../../src/features/forum/auth.ts'
// prettier-ignore
import { ForumApiError, getConnectionTicket } from '../../../src/features/forum/forumApi.ts'
import { subscribeToRoom } from '../../../src/features/forum/forumSocket.ts'

vi.mock('../../../src/features/forum/forumApi.ts', async (original) => ({
  ...(await original<
    typeof import('../../../src/features/forum/forumApi.ts')
  >()),
  getConnectionTicket: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('sign-in', () => {
  const sessionKey = 'lecturekaki:auth:v1'
  const loginKey = 'lecturekaki:login:v1'
  const hintKey = 'lecturekaki:login-hint:v1'
  const fetcher = vi.fn()
  const store = (key: string, value: unknown) =>
    sessionStorage.setItem(key, JSON.stringify(value))
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    document.cookie = `${hintKey}=; Max-Age=0; Path=/`
    vi.stubGlobal('location', {
      origin: 'http://localhost:5173',
      assign: vi.fn(),
    })
    vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://login.example')
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'public-client')
    fetcher.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-token', expires_in: 900 }),
    })
    vi.stubGlobal('fetch', fetcher)
  })

  it('requires sign-in without a tab session', async () => {
    await expect(getAccessToken()).rejects.toBeInstanceOf(SignInRequired)
  })
  it('starts sign-in with PKCE, state and the selected room return path', async () => {
    await startSignIn('/forum/selected-room')
    const pending = JSON.parse(sessionStorage.getItem(loginKey)!)
    const url = new URL(vi.mocked(location.assign).mock.calls[0][0])
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe(pending.state)
    expect(pending.returnTo).toBe('/forum/selected-room')
  })
  it('exchanges a valid callback once and restores the room', async () => {
    store(loginKey, {
      state: 'matching',
      verifier: 'test-verifier',
      returnTo: '/forum/selected-room',
    })
    const url =
      'http://localhost:5173/auth/callback?code=primary-code&state=matching'
    expect(
      await Promise.all([completeSignIn(url), completeSignIn(url)]),
    ).toEqual(['/forum/selected-room', '/forum/selected-room'])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(await getAccessToken()).toBe('new-token')
  })
  it('rejects an incorrect callback state before exchanging a code', async () => {
    store(loginKey, {
      state: 'expected',
      verifier: 'test-verifier',
      returnTo: '/forum',
    })
    await expect(
      completeSignIn(
        'http://localhost:5173/auth/callback?code=bad-primary-code&state=wrong',
      ),
    ).rejects.toThrow('did not match')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refreshes an expired access token', async () => {
    store(sessionKey, {
      access_token: 'old',
      refresh_token: 'test-refresh',
      expires_at: 0,
    })
    expect(await getAccessToken()).toBe('new-token')
  })
  it('automatically reconnects a returning user in a fresh tab', async () => {
    document.cookie = `${hintKey}=${encodeURIComponent(JSON.stringify({ signedIn: true, logoutVersion: '' }))}; Path=/`
    expect(await tryAutomaticSignIn('/forum/selected-room')).toBe(true)
    expect(location.assign).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(sessionKey)).toBeNull()
  })
  it('clears the session and returns through Cognito logout', async () => {
    store(sessionKey, { access_token: 'old', expires_at: Date.now() + 900000 })
    await signOut()
    expect(sessionStorage.getItem(sessionKey)).toBeNull()
    await expect(getAccessToken()).rejects.toBeInstanceOf(SignInRequired)
    expect(new URL(vi.mocked(location.assign).mock.calls[0][0]).pathname).toBe(
      '/logout',
    )
  })
})

describe('live connection', () => {
  class Socket {
    static OPEN = 1
    static instances: Socket[] = []
    readyState = 1
    onopen?: () => void
    onclose?: () => void
    onmessage?: (event: { data: string }) => void
    send = vi.fn()
    close = vi.fn(() => {
      this.readyState = 3
      this.onclose?.()
    })
    constructor() {
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
    for (const room_id of ['room-a', 'room-b']) {
      const event = { type: 'message.deleted', room_id, message_id: 'm1' }
      socket.onmessage?.({ data: JSON.stringify(event) })
    }
    expect(h.onEvent).not.toHaveBeenCalled()
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.onEvent).toHaveBeenCalledOnce()
    expect(h.onEvent.mock.calls[0][0]).toEqual({
      type: 'message.deleted',
      room_id: 'room-a',
      message_id: 'm1',
    })
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
})
