const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

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
  if (!res.ok) throw new Error(`GET messages failed: ${res.status}`)
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
  if (!res.ok) throw new Error(`POST message failed: ${res.status}`)
  return res.json() as Promise<MessageOut>
}

export async function deleteMessage(
  roomId: string,
  messageId: string,
  getToken: () => Promise<string>,
): Promise<void> {
  const res = await apiFetch(
    `/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
    getToken,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(`DELETE message failed: ${res.status}`)
}
