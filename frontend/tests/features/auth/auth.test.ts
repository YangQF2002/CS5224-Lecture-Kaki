import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  completeSignIn,
  getAccessToken,
  SignInRequired,
  signOut,
  startSignIn,
} from '../../../src/features/auth/auth.ts'

beforeEach(() => {
  sessionStorage.clear()
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://login.example')
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'public-client')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it('requires sign-in without a session', async () => {
  await expect(getAccessToken()).rejects.toBeInstanceOf(SignInRequired)
})
it('uses a fresh token without a network call', async () => {
  sessionStorage.setItem(
    'lecturekaki:auth:v1',
    JSON.stringify({ access_token: 'fresh', expires_at: Date.now() + 600000 }),
  )
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  expect(await getAccessToken()).toBe('fresh')
  expect(fetcher).not.toHaveBeenCalled()
})
it('refreshes once for concurrent requests', async () => {
  sessionStorage.setItem(
    'lecturekaki:auth:v1',
    JSON.stringify({
      access_token: 'old',
      refresh_token: 'refresh',
      expires_at: 0,
    }),
  )
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: 'new', expires_in: 900 }),
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await Promise.all([getAccessToken(), getAccessToken()])).toEqual([
    'new',
    'new',
  ])
  expect(fetcher).toHaveBeenCalledOnce()
})
it('rejects a mismatched OAuth state before exchanging a code', async () => {
  sessionStorage.setItem(
    'lecturekaki:login:v1',
    JSON.stringify({
      state: 'expected',
      verifier: 'secret',
      returnTo: '/forum',
    }),
  )
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(
    completeSignIn(
      'http://localhost/auth/callback?code=wrong-state-code&state=wrong',
    ),
  ).rejects.toThrow('did not match')
  expect(fetcher).not.toHaveBeenCalled()
})
it('exchanges a matching callback code once under StrictMode', async () => {
  sessionStorage.setItem(
    'lecturekaki:login:v1',
    JSON.stringify({
      state: 'expected',
      verifier: 'verifier',
      returnTo: '/forum/room',
    }),
  )
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      access_token: 'new',
      expires_in: 900,
      refresh_token: 'refresh',
    }),
  })
  vi.stubGlobal('fetch', fetcher)
  const url = 'http://localhost/auth/callback?code=valid-code&state=expected'
  expect(await Promise.all([completeSignIn(url), completeSignIn(url)])).toEqual(
    ['/forum/room', '/forum/room'],
  )
  expect(fetcher).toHaveBeenCalledOnce()
  expect(String(fetcher.mock.calls[0][1].body)).toContain(
    'code_verifier=verifier',
  )
})

it('does not restore a session if a token refresh finishes after sign-out', async () => {
  vi.stubGlobal('location', { origin: 'http://localhost', assign: vi.fn() })
  sessionStorage.setItem(
    'lecturekaki:auth:v1',
    JSON.stringify({
      access_token: 'old',
      refresh_token: 'refresh',
      expires_at: 0,
    }),
  )
  let finish!: (value: unknown) => void
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.endsWith('/oauth2/token')
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.resolve({ ok: true }),
    ),
  )
  const result = getAccessToken().then(
    (token) => ({ token, error: undefined }),
    (error) => ({ token: undefined, error }),
  )
  await signOut()
  finish({
    ok: true,
    json: async () => ({ access_token: 'new', expires_in: 900 }),
  })
  expect((await result).error).toBeInstanceOf(SignInRequired)
  expect(sessionStorage.getItem('lecturekaki:auth:v1')).toBeNull()
})

it('rejects a callback on another website before redirecting to login', async () => {
  const assign = vi.fn()
  vi.stubGlobal('location', { origin: 'http://localhost:8080', assign })
  vi.stubEnv('VITE_COGNITO_REDIRECT_URI', 'http://localhost:5173/auth/callback')
  await expect(startSignIn()).rejects.toThrow('different website')
  expect(assign).not.toHaveBeenCalled()
})

it('starts login when the callback belongs to the current website', async () => {
  const assign = vi.fn()
  vi.stubGlobal('location', { origin: 'http://localhost:5173', assign })
  vi.stubEnv('VITE_COGNITO_REDIRECT_URI', 'http://localhost:5173/auth/callback')
  await startSignIn('/forum/room')
  expect(assign).toHaveBeenCalledOnce()
  const url = new URL(assign.mock.calls[0][0])
  expect(url.searchParams.get('redirect_uri')).toBe(
    'http://localhost:5173/auth/callback',
  )
  const pending = JSON.parse(sessionStorage.getItem('lecturekaki:login:v1')!)
  expect(url.searchParams.get('state')).toBe(pending.state)
  expect(pending.returnTo).toBe('/forum/room')
})
