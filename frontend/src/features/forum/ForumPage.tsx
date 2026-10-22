import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import {
  deleteMessage,
  getMessages,
  postMessage,
  type MessageOut,
} from './forumApi.ts'
import './forum.css'

const MAX_CONTENT = 500
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

/**
 * Placeholder token provider. Replace with the shared auth module once
 * the team's login flow is available.
 */
async function getToken(): Promise<string> {
  // TODO: replace with shared auth module, e.g. authModule.getAccessToken()
  throw new Error('unauthenticated')
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ForumPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const [messages, setMessages] = useState<MessageOut[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [unauthenticated, setUnauthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sendError, setSendError] = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Initial load: fetch current user and first page of messages together.
  useEffect(() => {
    if (!roomId) return
    let cancelled = false

    async function init() {
      try {
        const token = await getToken()
        const [meRes, page] = await Promise.all([
          fetch(`${API_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          getMessages(roomId!, getToken),
        ])
        if (cancelled) return
        const me = (await meRes.json()) as { user_id: string }
        setCurrentUserId(me.user_id)
        setMessages(page.items)
        setNextCursor(page.next_cursor)
      } catch (err) {
        if (cancelled) return
        if (err instanceof Error && err.message === 'unauthenticated') {
          setUnauthenticated(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [roomId])

  // Scroll to bottom after initial load.
  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView()
  }, [loading])

  async function loadOlder() {
    if (!roomId || !nextCursor) return
    setLoadingOlder(true)
    try {
      const page = await getMessages(roomId, getToken, nextCursor)
      setMessages((prev) => [...page.items, ...prev])
      setNextCursor(page.next_cursor)
    } finally {
      setLoadingOlder(false)
    }
  }

  async function handleSend() {
    if (!roomId || !content.trim() || content.length > MAX_CONTENT) return
    setSending(true)
    setSendError('')
    try {
      const msg = await postMessage(roomId, content.trim(), getToken)
      setMessages((prev) => [...prev, msg])
      setContent('')
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }),
        50,
      )
    } catch {
      setSendError('Failed to send. Please try again.')
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(messageId: string) {
    if (!roomId) return
    try {
      await deleteMessage(roomId, messageId, getToken)
      setMessages((prev) => prev.filter((m) => m.message_id !== messageId))
    } catch {
      setSendError('Failed to delete message.')
    }
  }

  if (unauthenticated) {
    return (
      <main className="forum-page">
        <p className="status-message">
          Sign in to view and post in this discussion.
        </p>
      </main>
    )
  }

  return (
    <main className="forum-page">
      <header>
        <h1>Lecture discussion</h1>
        <p>{roomId}</p>
      </header>

      {nextCursor && (
        <button
          className="panel load-older"
          disabled={loadingOlder}
          onClick={() => void loadOlder()}
        >
          {loadingOlder ? 'Loading…' : 'Load older messages'}
        </button>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : messages.length === 0 ? (
        <p className="status-message">No messages yet. Be the first to post.</p>
      ) : (
        <div className="message-list">
          {messages.map((msg) => {
            const own = msg.author_id === currentUserId
            return (
              <article
                key={msg.message_id}
                className={`message${own ? ' own' : ''}`}
              >
                <div className="message-header">
                  <span className="message-author">
                    {own ? 'You' : 'Student'}
                  </span>
                  <span className="message-time">
                    {formatTime(msg.posted_at)}
                  </span>
                  {own && (
                    <button
                      className="message-delete"
                      onClick={() => void handleDelete(msg.message_id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <p className="message-content">{msg.content}</p>
              </article>
            )
          })}
        </div>
      )}

      <div ref={bottomRef} />

      <section className="panel composer">
        <textarea
          value={content}
          placeholder="Write a message…"
          onChange={(e) => {
            setContent(e.target.value)
            setSendError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSend()
          }}
          disabled={sending}
        />
        <div className="composer-footer">
          <span
            className={`char-count${content.length > MAX_CONTENT ? ' over' : ''}`}
          >
            {content.length}/{MAX_CONTENT}
          </span>
          <button
            onClick={() => void handleSend()}
            disabled={
              sending || !content.trim() || content.length > MAX_CONTENT
            }
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        {sendError && <p className="status-message">{sendError}</p>}
      </section>
    </main>
  )
}
