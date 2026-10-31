import { SignInRequired } from '../forum/auth.ts'
import type { TimetableBook } from './types.ts'

const API_BASE = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

export class TimetableApiError extends Error {
  status: number

  constructor(status: number, detail?: string) {
    super(detail || `Timetable request failed (${status}).`)
    this.status = status
  }
}

async function apiFetch(
  getToken: () => Promise<string>,
  init: RequestInit = {},
): Promise<Response> {
  let token: string
  try {
    token = await getToken()
  } catch (error) {
    if (error instanceof SignInRequired) throw error
    throw error
  }

  const response = await fetch(`${API_BASE}/timetable/semesters`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      detail?: unknown
    } | null
    throw new TimetableApiError(
      response.status,
      typeof body?.detail === 'string' ? body.detail : undefined,
    )
  }
  return response
}

export async function getRemoteTimetable(
  getToken: () => Promise<string>,
): Promise<TimetableBook | null> {
  try {
    const response = await apiFetch(getToken)
    return (await response.json()) as TimetableBook
  } catch (error) {
    if (error instanceof TimetableApiError && error.status === 404) return null
    throw error
  }
}

export function saveRemoteTimetable(
  book: TimetableBook,
  getToken: () => Promise<string>,
): Promise<void> {
  return apiFetch(getToken, {
    method: 'PUT',
    body: JSON.stringify(book),
  }).then(() => undefined)
}
