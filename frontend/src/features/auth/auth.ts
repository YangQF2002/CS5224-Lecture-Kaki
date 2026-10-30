/** Small Cognito Hosted UI client. Public configuration only; never AWS keys. */
const SESSION_KEY = 'lecturekaki:auth:v1'
const LOGIN_KEY = 'lecturekaki:login:v1'
let sessionVersion = 0

interface Session {
  access_token: string
  refresh_token?: string
  expires_at: number
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

async function exchange(
  params: URLSearchParams,
  previous?: Session,
  version = sessionVersion,
): Promise<Session> {
  const { domain, clientId } = config()
  params.set('client_id', clientId)
  const response = await fetch(`${domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  if (version !== sessionVersion) throw new SignInRequired()
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
  }
  if (version !== sessionVersion) throw new SignInRequired()
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

let refreshing: { version: number; promise: Promise<Session> } | undefined

export async function getAccessToken(): Promise<string> {
  const session = readSession()
  if (!session) throw new SignInRequired()
  if (session.expires_at > Date.now() + 30_000) return session.access_token
  if (!session.refresh_token) throw new SignInRequired()
  const version = sessionVersion
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
      ),
    }
  }
  const request = refreshing
  try {
    const refreshed = await request.promise
    if (version !== sessionVersion) throw new SignInRequired()
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
  const { domain, clientId, redirectUri } = config()
  if (new URL(redirectUri).origin !== location.origin) {
    throw new Error(
      'Sign-in is configured for a different website. Contact the app owner.',
    )
  }
  sessionVersion += 1
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)))
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  )
  sessionStorage.setItem(
    LOGIN_KEY,
    JSON.stringify({ state, verifier, returnTo: localPath(returnTo) }),
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
  if (!code || params.has('error'))
    return Promise.reject(new Error('Sign-in was cancelled or failed.'))
  // React StrictMode can mount the callback twice; exchange each code once.
  if (callback?.code === code) return callback.promise
  const promise = (async () => {
    const pending = JSON.parse(sessionStorage.getItem(LOGIN_KEY) || 'null') as {
      state: string
      verifier: string
      returnTo: string
    } | null
    if (!pending || pending.state !== params.get('state'))
      throw new Error('Sign-in session did not match. Please start again.')
    sessionStorage.removeItem(LOGIN_KEY)
    await exchange(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: pending.verifier,
        redirect_uri: config().redirectUri,
      }),
    )
    return localPath(pending.returnTo)
  })()
  callback = { code, promise }
  return promise
}

export async function signOut(): Promise<void> {
  const session = readSession()
  sessionVersion += 1
  sessionStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(LOGIN_KEY)
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
