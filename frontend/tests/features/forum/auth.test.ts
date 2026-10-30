import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  completeSignIn,
  getAccessToken,
  SignInRequired,
  signOut,
  startSignIn,
  tryAutomaticSignIn,
} from '../../../src/features/forum/auth.ts'

const sessionKey = 'lecturekaki:auth:v1'
const loginKey = 'lecturekaki:login:v1'
const hintKey = 'lecturekaki:login-hint:v1'
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
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
function response() {
  return {
    ok: true,
    json: async () => ({ access_token: 'new-token', expires_in: 900 }),
  }
}

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
  sessionStorage.setItem(
    loginKey,
    JSON.stringify({
      state: 'matching',
      verifier: 'test-verifier',
      returnTo: '/forum/selected-room',
    }),
  )
  const fetcher = vi.fn().mockResolvedValue(response())
  vi.stubGlobal('fetch', fetcher)
  const url =
    'http://localhost:5173/auth/callback?code=primary-code&state=matching'
  expect(await Promise.all([completeSignIn(url), completeSignIn(url)])).toEqual(
    ['/forum/selected-room', '/forum/selected-room'],
  )
  expect(fetcher).toHaveBeenCalledOnce()
  expect(await getAccessToken()).toBe('new-token')
})
it('rejects an incorrect callback state before exchanging a code', async () => {
  sessionStorage.setItem(
    loginKey,
    JSON.stringify({
      state: 'expected',
      verifier: 'test-verifier',
      returnTo: '/forum',
    }),
  )
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(
    completeSignIn(
      'http://localhost:5173/auth/callback?code=bad-primary-code&state=wrong',
    ),
  ).rejects.toThrow('did not match')
  expect(fetcher).not.toHaveBeenCalled()
})
it('refreshes an expired access token', async () => {
  sessionStorage.setItem(
    sessionKey,
    JSON.stringify({
      access_token: 'old',
      refresh_token: 'test-refresh',
      expires_at: 0,
    }),
  )
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
  expect(await getAccessToken()).toBe('new-token')
})
it('automatically reconnects a returning user in a fresh tab', async () => {
  document.cookie = `${hintKey}=${encodeURIComponent(JSON.stringify({ signedIn: true, logoutVersion: '' }))}; Path=/`
  expect(await tryAutomaticSignIn('/forum/selected-room')).toBe(true)
  expect(location.assign).toHaveBeenCalledOnce()
  expect(sessionStorage.getItem(sessionKey)).toBeNull()
})
it('clears the session and returns through Cognito logout', async () => {
  sessionStorage.setItem(
    sessionKey,
    JSON.stringify({ access_token: 'old', expires_at: Date.now() + 900000 }),
  )
  await signOut()
  expect(sessionStorage.getItem(sessionKey)).toBeNull()
  await expect(getAccessToken()).rejects.toBeInstanceOf(SignInRequired)
  expect(new URL(vi.mocked(location.assign).mock.calls[0][0]).pathname).toBe(
    '/logout',
  )
})
