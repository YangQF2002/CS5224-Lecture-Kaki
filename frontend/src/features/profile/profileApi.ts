import { SignInRequired } from '../forum/auth.ts'

const API_BASE = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

export type Profile = {
  username: string
  topics: string[]
}

const profileListeners = new Set<(profile: Profile) => void>()

export function subscribeToProfileUpdates(
  listener: (profile: Profile) => void,
) {
  profileListeners.add(listener)
  return () => {
    profileListeners.delete(listener)
  }
}

// Topics picked while signed out live in this browser only.
const LOCAL_TOPICS_KEY = 'lecturekaki:topics:v1'
const topicListeners = new Set<(topics: string[]) => void>()

/** Called with the new list whenever topics are saved, here or to the account. */
export function subscribeToTopicUpdates(listener: (topics: string[]) => void) {
  topicListeners.add(listener)
  return () => {
    topicListeners.delete(listener)
  }
}

function notifyTopics(topics: string[]) {
  for (const listener of topicListeners) listener(topics)
}

export function loadLocalTopics(): string[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(LOCAL_TOPICS_KEY) ?? '[]',
    )
    return Array.isArray(stored)
      ? stored.filter((topic): topic is string => typeof topic === 'string')
      : []
  } catch {
    return []
  }
}

export function saveLocalTopics(topics: string[]) {
  try {
    localStorage.setItem(LOCAL_TOPICS_KEY, JSON.stringify(topics))
  } catch {
    // Storage can be unavailable (e.g. private mode); keep them for this visit.
  }
  notifyTopics(topics)
}

// Mirrors the API's rule; the server is the authority.
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/

class ProfileApiError extends Error {
  status: number

  constructor(status: number, detail?: string) {
    super(detail || `Profile request failed (${status}).`)
    this.status = status
  }
}

async function request(
  path: string,
  getToken: () => Promise<string>,
  init: RequestInit = {},
): Promise<Profile> {
  const token = await getToken()
  const response = await fetch(`${API_BASE}/profile${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
  if (response.status === 401) throw new SignInRequired()
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      detail?: unknown
    } | null
    throw new ProfileApiError(
      response.status,
      typeof body?.detail === 'string' ? body.detail : undefined,
    )
  }
  return (await response.json()) as Profile
}

export function getProfile(getToken: () => Promise<string>): Promise<Profile> {
  return request('', getToken)
}

export async function saveTopics(
  topics: string[],
  getToken: () => Promise<string>,
): Promise<Profile> {
  const profile = await request('/topics', getToken, {
    method: 'PUT',
    body: JSON.stringify({ topics }),
  })
  notifyTopics(profile.topics)
  return profile
}

export async function saveUsername(
  username: string,
  getToken: () => Promise<string>,
): Promise<Profile> {
  const profile = await request('/username', getToken, {
    method: 'PUT',
    body: JSON.stringify({ username }),
  })
  for (const listener of profileListeners) listener(profile)
  return profile
}
