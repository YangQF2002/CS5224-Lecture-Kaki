import { SignInRequired } from './auth.ts'

const API_BASE = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

export class ForumApiError extends Error {
  status: number
  constructor(status: number) {
    super(
      status === 401
        ? 'Sign in to continue.'
        : `Forum request failed (${status}).`,
    )
    this.status = status
  }
}

export function needsSignIn(error: unknown): boolean {
  return (
    error instanceof SignInRequired ||
    (error instanceof ForumApiError && error.status === 401)
  )
}

export interface MessageOut {
  message_id: string
  room_id: string
  author_id: string
  content: string
  posted_at: string
  expires_at: string
}

export interface MessagePage {
  items: MessageOut[]
  next_cursor: string | null
}

async function apiFetch(
  path: string,
  getToken: () => Promise<string>,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new ForumApiError(res.status)
  return res
}

export async function getMessages(
  roomId: string,
  getToken: () => Promise<string>,
  cursor?: string,
  limit = 50,
): Promise<MessagePage> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  const res = await apiFetch(
    `/rooms/${encodeURIComponent(roomId)}/messages?${params}`,
    getToken,
  )
  return res.json() as Promise<MessagePage>
}

export async function postMessage(
  roomId: string,
  content: string,
  getToken: () => Promise<string>,
): Promise<MessageOut> {
  const res = await apiFetch(
    `/rooms/${encodeURIComponent(roomId)}/messages`,
    getToken,
    { method: 'POST', body: JSON.stringify({ content }) },
  )
  return res.json() as Promise<MessageOut>
}

export async function deleteMessage(
  roomId: string,
  messageId: string,
  getToken: () => Promise<string>,
): Promise<void> {
  await apiFetch(
    `/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
    getToken,
    { method: 'DELETE' },
  )
}

export async function getCurrentUser(
  getToken: () => Promise<string>,
): Promise<{ user_id: string }> {
  const res = await apiFetch('/auth/me', getToken)
  return res.json() as Promise<{ user_id: string }>
}

export async function getConnectionTicket(
  roomId: string,
  getToken: () => Promise<string>,
): Promise<{ path: string; session_expires_at: number }> {
  const res = await apiFetch(
    `/rooms/${encodeURIComponent(roomId)}/connection-ticket`,
    getToken,
    { method: 'POST' },
  )
  return res.json() as Promise<{ path: string; session_expires_at: number }>
}

export function forumSocketUrl(path: string): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
