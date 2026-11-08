import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// prettier-ignore
import { completeSignIn, getAccessToken, SignInRequired, signOut, startPasswordChange, startSignIn, tryAutomaticSignIn } from '../../../src/features/forum/auth.ts'
// prettier-ignore
import { ForumApiError, forumSocketUrl, getConnectionTicket, postMessage } from '../../../src/features/forum/forumApi.ts'
import { downloadPdf, uploadPdf } from '../../../src/features/forum/forumPdf.ts'
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
    vi.stubEnv(
      'VITE_COGNITO_REDIRECT_URI',
      'http://localhost:5173/auth/callback',
    )
    vi.stubEnv('VITE_COGNITO_LOGOUT_URI', 'http://localhost:5173/forum')
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
  it('opens hosted password recovery and completes sign-in with PKCE back to the current page', async () => {
    const returnTo = '/?topics=Psychology#main-content'
    await startPasswordChange(returnTo)
    const pending = JSON.parse(sessionStorage.getItem(loginKey)!)
    const url = new URL(vi.mocked(location.assign).mock.calls[0][0])
    expect(url.origin).toBe('https://login.example')
    expect(url.pathname).toBe('/forgotPassword')
    expect(url.searchParams.get('client_id')).toBe('public-client')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid')
    expect(url.searchParams.get('state')).toBe(pending.state)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(pending.verifier),
      ),
    )
    const challenge = btoa(String.fromCharCode(...digest))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(url.searchParams.get('code_challenge')).toBe(challenge)
    const callbackUrl = new URL(url.searchParams.get('redirect_uri')!)
    callbackUrl.searchParams.set('code', 'password-recovery-code')
    callbackUrl.searchParams.set('state', pending.state)
    expect(await completeSignIn(callbackUrl.href)).toBe(returnTo)
    expect(fetcher).toHaveBeenCalledOnce()
    const params = fetcher.mock.calls[0][1].body as URLSearchParams
    expect(params.get('code_verifier')).toBe(pending.verifier)
    expect(await getAccessToken()).toBe('new-token')
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
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ action: 'ready' }),
    )
    expect(h.onReady).not.toHaveBeenCalled()
    socket.onmessage?.({
      data: JSON.stringify({ type: 'ready', room_id: 'room-b' }),
    })
    expect(h.onReady).not.toHaveBeenCalled()
    socket.onmessage?.({
      data: JSON.stringify({ type: 'ready', room_id: 'room-a' }),
    })
    socket.onmessage?.({
      data: JSON.stringify({ type: 'ready', room_id: 'room-a' }),
    })
    expect(h.onReady).toHaveBeenCalledOnce()
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
  it('reconnects when readiness is not acknowledged instead of claiming connected', async () => {
    const h = handlers()
    const stop = subscribeToRoom('room-a', async () => 'token', h)
    await vi.advanceTimersByTimeAsync(0)
    Socket.instances[0].onopen?.()
    await vi.advanceTimersByTimeAsync(11_000)
    expect(Socket.instances[0].close).toHaveBeenCalledOnce()
    expect(h.onReady).not.toHaveBeenCalled()
    expect(h.onStatus).not.toHaveBeenCalledWith('connected')
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

describe('PDF uploads', () => {
  const file = new File(['pdf'], 'notes.pdf', { type: 'application/pdf' })
  const headers = { 'Content-Type': 'application/pdf', 'If-None-Match': '*' }
  const receipt = {
    upload_id: 'upload-one',
    url: 'https://bucket.example/upload',
    headers,
  }
  const token = async () => 'token'

  it('uploads with conditional headers and reuses its receipt when retrying', async () => {
    const controller = new AbortController()
    const uploaded = vi.fn()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(receipt))
      .mockResolvedValueOnce(new Response())
      .mockImplementation(async () => Response.json({ status: 'ready' }))
    vi.stubGlobal('fetch', fetcher)
    const id = await uploadPdf(
      'room/venue',
      file,
      token,
      controller.signal,
      vi.fn(),
      uploaded,
    )
    expect(id).toBe(receipt.upload_id)
    expect(uploaded).toHaveBeenCalledWith(id)
    expect(fetcher.mock.calls[0][0]).toContain(
      'room%2Fvenue/attachment-uploads',
    )
    expect(fetcher.mock.calls[1]).toEqual([
      receipt.url,
      { method: 'PUT', body: file, headers, signal: controller.signal },
    ])
    expect(fetcher.mock.calls[2][1].headers.Authorization).toBe('Bearer token')
    await uploadPdf(
      'room/venue',
      file,
      token,
      controller.signal,
      vi.fn(),
      uploaded,
      id,
    )
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fetcher.mock.calls[3][0]).toContain('/attachment-uploads/upload-one')
  })

  it.each(['fails', 'is cancelled'])(
    'stops before validation when a PUT %s',
    async (outcome) => {
      const controller = new AbortController()
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(Response.json(receipt))
        .mockImplementationOnce(async () => {
          if (outcome === 'is cancelled') controller.abort()
          return new Response(null, { status: outcome === 'fails' ? 403 : 200 })
        })
      vi.stubGlobal('fetch', fetcher)
      await expect(
        uploadPdf('room', file, token, controller.signal, vi.fn(), vi.fn()),
      ).rejects.toMatchObject(
        outcome === 'fails'
          ? { message: 'PDF upload failed. Please retry.' }
          : { name: 'AbortError' },
      )
      expect(fetcher).toHaveBeenCalledTimes(2)
    },
  )
})

it('does not start a message POST when cancelled during token refresh', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ message_id: 'late-message' }),
  })
  vi.stubGlobal('fetch', fetcher)
  let finish!: (token: string) => void
  const token = new Promise<string>((resolve) => {
    finish = resolve
  })
  const request = postMessage(
    'room',
    'draft',
    () => token,
    undefined,
    controller.signal,
  )
  const cancelled = expect(request).rejects.toHaveProperty('name', 'AbortError')
  controller.abort()
  finish('test-token')
  await cancelled
  expect(fetcher).not.toHaveBeenCalled()
})

describe('PDF downloads', () => {
  function download(signal = new AbortController().signal) {
    return downloadPdf(
      'room/venue',
      'message',
      'lecture.pdf',
      async () => 'token',
      signal,
    )
  }

  it('authorizes once and opens the signed S3 URL directly', async () => {
    const url =
      'https://bucket.example/pdf?versionId=pinned&X-Amz-Signature=signed'
    const fetcher = vi.fn().mockResolvedValue(Response.json({ url }))
    vi.stubGlobal('fetch', fetcher)
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    await download()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toContain(
      'room%2Fvenue/messages/message/attachment',
    )
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer token')
    expect(click).toHaveBeenCalledOnce()
    expect(click.mock.contexts[0]).toMatchObject({
      href: url,
      download: 'lecture.pdf',
      referrerPolicy: 'no-referrer',
    })
  })

  it('discards a signed link returned after cancellation', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          controller.abort()
          return { url: 'https://bucket.example/pdf' }
        },
      }),
    )
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    await expect(download(controller.signal)).rejects.toHaveProperty(
      'name',
      'AbortError',
    )
    expect(click).not.toHaveBeenCalled()
  })
})

describe('live connection URL', () => {
  it('uses the API Gateway WebSocket URL as given and resolves local paths against the API', () => {
    const gateway =
      'wss://abc.execute-api.ap-southeast-1.amazonaws.com/live?room=r&ticket=t'
    expect(forumSocketUrl(gateway)).toBe(gateway)
    expect(forumSocketUrl('/rooms/r/live?ticket=t')).toBe(
      'ws://localhost:8000/rooms/r/live?ticket=t',
    )
  })
})
