/** Small Cognito Hosted UI client. Public configuration only; never AWS keys. */
const SESSION_KEY = 'lecturekaki:auth:v1'
const LOGIN_KEY = 'lecturekaki:login:v1'
const BROWSER_LOGIN_KEY = 'lecturekaki:login-hint:v1'
const SIGN_OUT_KEY = 'lecturekaki:sign-out:v1'
const AUTO_SIGN_IN_KEY = 'lecturekaki:auto-sign-in:v1'
let sessionVersion = 0
const signOutListeners = new Set<() => void>()

interface Session {
  access_token: string
  refresh_token?: string
  expires_at: number
  logoutVersion?: string
}

export class SignInRequired extends Error {
  constructor() {
    super('Sign in to continue.')
  }
}

function config() {
  const domain = import.meta.env.VITE_COGNITO_DOMAIN?.replace(/\/$/, '')
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID
  if (!domain || !clientId) {
    throw new Error(
      'Cognito login is not configured. Check the frontend configuration.',
    )
  }
  return {
    domain,
    clientId,
    redirectUri:
      import.meta.env.VITE_COGNITO_REDIRECT_URI ||
      `${location.origin}/auth/callback`,
    logoutUri:
      import.meta.env.VITE_COGNITO_LOGOUT_URI || `${location.origin}/forum`,
  }
}

function readSession(): Session | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(SESSION_KEY) || 'null',
    ) as Session | null
  } catch {
    return null
  }
}

export function getLogoutVersion(): string {
  try {
    return localStorage.getItem(SIGN_OUT_KEY) || ''
  } catch {
    return ''
  }
}

// Only this non-secret hint is browser-wide. Tokens and PKCE state stay per-tab.
function browserLogin(): { signedIn: boolean; logoutVersion: string } {
  let logoutVersion = ''
  try {
    // Automatic entry needs the cross-tab logout revision as well as the hint.
    logoutVersion = localStorage.getItem(SIGN_OUT_KEY) || ''
    const match = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${BROWSER_LOGIN_KEY}=`))
    const value = match
      ? JSON.parse(decodeURIComponent(match.split('=').slice(1).join('=')))
      : null
    return {
      signedIn:
        value?.signedIn === true && value.logoutVersion === logoutVersion,
      logoutVersion,
    }
  } catch {
    /* Storage restrictions disable automatic sign-in; manual sign-in still works. */
  }
  return { signedIn: false, logoutVersion }
}

function rememberLogin(signedIn: boolean, logoutVersion: string) {
  try {
    document.cookie = `${BROWSER_LOGIN_KEY}=${encodeURIComponent(
      JSON.stringify({ signedIn, logoutVersion }),
    )}; path=/; SameSite=Strict`
  } catch {
    /* Tokens can still be used in this tab without the browser-wide hint. */
  }
}

function requireCurrentSession(version: number, logoutVersion: string) {
  if (
    version !== sessionVersion ||
    logoutVersion !== browserLogin().logoutVersion
  )
    throw new SignInRequired()
}

function clearSession() {
  sessionVersion += 1
  sessionStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(LOGIN_KEY)
}

export function subscribeToSignOut(listener: () => void): () => void {
  signOutListeners.add(listener)
  function onStorage(event: StorageEvent) {
    if (event.key !== SIGN_OUT_KEY && event.key !== null) return
    const hint = browserLogin()
    const session = readSession()
    if (
      hint.signedIn &&
      (!session || (session.logoutVersion ?? '') === hint.logoutVersion)
    )
      return
    clearSession()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    signOutListeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

// Clear the redirect guard only after the API accepts the authenticated session.
export function confirmSignedIn() {
  sessionStorage.removeItem(AUTO_SIGN_IN_KEY)
}

async function exchange(
  params: URLSearchParams,
  previous?: Session,
  version = sessionVersion,
  logoutVersion = browserLogin().logoutVersion,
): Promise<Session> {
  requireCurrentSession(version, logoutVersion)
  const { domain, clientId } = config()
  params.set('client_id', clientId)
  const response = await fetch(`${domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  requireCurrentSession(version, logoutVersion)
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      sessionStorage.removeItem(SESSION_KEY)
      throw new SignInRequired()
    }
    throw new Error('Sign-in service is unavailable. Please try again.')
  }
  const result = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  if (!result.access_token || !Number.isFinite(result.expires_in)) {
    throw new Error('Unexpected sign-in response.')
  }
  const session = {
    access_token: result.access_token,
    refresh_token: result.refresh_token ?? previous?.refresh_token,
    expires_at: Date.now() + result.expires_in * 1000,
    logoutVersion,
  }
  requireCurrentSession(version, logoutVersion)
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  rememberLogin(true, logoutVersion)
  return session
}

let refreshing: { version: number; promise: Promise<Session> } | undefined

export async function getAccessToken(): Promise<string> {
  const session = readSession()
  if (
    !session ||
    (session.logoutVersion ?? '') !== browserLogin().logoutVersion
  ) {
    sessionStorage.removeItem(SESSION_KEY)
    throw new SignInRequired()
  }
  if (session.expires_at > Date.now() + 30_000) {
    rememberLogin(true, session.logoutVersion ?? '')
    return session.access_token
  }
  if (!session.refresh_token) throw new SignInRequired()
  const version = sessionVersion
  const logoutVersion = session.logoutVersion ?? ''
  if (!refreshing || refreshing.version !== version) {
    refreshing = {
      version,
      promise: exchange(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: session.refresh_token,
        }),
        session,
        version,
        logoutVersion,
      ),
    }
  }
  const request = refreshing
  try {
    const refreshed = await request.promise
    requireCurrentSession(version, logoutVersion)
    return refreshed.access_token
  } finally {
    if (refreshing === request) refreshing = undefined
  }
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function localPath(value: string): string {
  return value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
    ? value
    : '/forum'
}

export async function startSignIn(returnTo = '/forum'): Promise<void> {
  sessionStorage.setItem(AUTO_SIGN_IN_KEY, 'manual')
  await authorize(returnTo)
}

export async function tryAutomaticSignIn(
  returnTo: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted || !browserLogin().signedIn) return false
  const attempt = base64url(crypto.getRandomValues(new Uint8Array(16)))
  try {
    if (sessionStorage.getItem(AUTO_SIGN_IN_KEY)) return false
    sessionStorage.setItem(AUTO_SIGN_IN_KEY, attempt)
  } catch {
    return false
  }
  try {
    await authorize(returnTo, signal)
    return true
  } catch (error) {
    // Always clear the guard so a future manual or automatic attempt is not blocked.
    if (sessionStorage.getItem(AUTO_SIGN_IN_KEY) === attempt)
      sessionStorage.removeItem(AUTO_SIGN_IN_KEY)
    throw error
  }
}

async function authorize(
  returnTo: string,
  signal?: AbortSignal,
): Promise<void> {
  const { domain, clientId, redirectUri } = config()
  if (new URL(redirectUri).origin !== location.origin) {
    throw new Error(
      'Sign-in is configured for a different website. Contact the app owner.',
    )
  }
  const version = ++sessionVersion
  const logoutVersion = browserLogin().logoutVersion
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)))
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  )
  requireCurrentSession(version, logoutVersion)
  if (signal?.aborted) throw new SignInRequired()
  sessionStorage.setItem(
    LOGIN_KEY,
    JSON.stringify({
      state,
      verifier,
      returnTo: localPath(returnTo),
      logoutVersion,
    }),
  )
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid',
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })
  location.assign(`${domain}/oauth2/authorize?${params}`)
}

let callback: { code: string; promise: Promise<string> } | undefined

export function completeSignIn(url: string): Promise<string> {
  const params = new URL(url).searchParams
  const code = params.get('code')
  if (!code || params.has('error')) {
    sessionStorage.removeItem(LOGIN_KEY)
    return Promise.reject(new Error('Sign-in was cancelled or failed.'))
  }
  // React StrictMode can mount the callback twice; exchange each code once.
  if (callback?.code === code) return callback.promise
  const promise = (async () => {
    const pending = JSON.parse(sessionStorage.getItem(LOGIN_KEY) || 'null') as {
      state: string
      verifier: string
      returnTo: string
      logoutVersion?: string
    } | null
    if (!pending || pending.state !== params.get('state'))
      throw new Error(
        !pending
          ? 'Sign-in session was lost (the tab may have been closed or storage was cleared). Please sign in again.'
          : 'Sign-in session did not match. Please start again.',
      )
    sessionStorage.removeItem(LOGIN_KEY)
    await exchange(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: pending.verifier,
        redirect_uri: config().redirectUri,
      }),
      undefined,
      sessionVersion,
      pending.logoutVersion ?? '',
    )
    return localPath(pending.returnTo)
  })()
  callback = { code, promise }
  return promise
}

export async function signOut(): Promise<void> {
  const session = readSession()
  const logoutVersion = base64url(crypto.getRandomValues(new Uint8Array(16)))
  try {
    localStorage.setItem(SIGN_OUT_KEY, logoutVersion)
  } catch {
    /* This tab still signs out when browser-wide storage is unavailable. */
  }
  rememberLogin(false, logoutVersion)
  clearSession()
  for (const listener of signOutListeners) listener()
  const { domain, clientId, logoutUri } = config()
  if (session?.refresh_token) {
    try {
      await fetch(`${domain}/oauth2/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          token: session.refresh_token,
        }),
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      /* Local session is already cleared; still end the hosted session. */
    }
  }
  location.assign(
    `${domain}/logout?${new URLSearchParams({ client_id: clientId, logout_uri: logoutUri })}`,
  )
}
