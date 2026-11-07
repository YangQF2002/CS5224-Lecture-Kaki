import { SignInRequired } from '../forum/auth.ts'

const API_BASE = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

export type Profile = {
  topics: string[]
}

class ProfileApiError extends Error {
  status: number

  constructor(status: number, detail?: string) {
    super(detail || `Profile request failed (${status}).`)
    this.status = status
  }
}

async function request(
  getToken: () => Promise<string>,
  init: RequestInit = {},
): Promise<Profile> {
  const token = await getToken()
  const response = await fetch(`${API_BASE}/profile`, {
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
  return request(getToken)
}

export function saveProfile(
  profile: Profile,
  getToken: () => Promise<string>,
): Promise<Profile> {
  return request(getToken, { method: 'PUT', body: JSON.stringify(profile) })
}
