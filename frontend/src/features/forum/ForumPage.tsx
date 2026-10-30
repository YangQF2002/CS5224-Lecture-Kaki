import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import {
  getAccessToken,
  SignInRequired,
  signOut,
  startSignIn,
} from '../auth/auth.ts'
import {
  deleteMessage,
  ForumApiError,
  getCurrentUser,
  getMessages,
  postMessage,
  type MessageOut,
} from './forumApi.ts'
import {
  subscribeToRoom,
  type LiveStatus,
  type RoomEvent,
} from './forumSocket.ts'
import './forum.css'

const MAX_CONTENT = 500

function mergeMessages(
  deleted: Set<string>,
  ...groups: MessageOut[][]
): MessageOut[] {
  const unique = new Map(
    groups.flat().map((message) => [message.message_id, message]),
  )
  return [...unique.values()]
    .filter(
      (message) =>
        !deleted.has(message.message_id) &&
        Date.parse(message.expires_at) > Date.now(),
    )
    .sort((a, b) => a.message_id.localeCompare(b.message_id))
}

function needsSignIn(error: unknown): boolean {
  return (
    error instanceof SignInRequired ||
    (error instanceof ForumApiError && error.status === 401)
  )
}

function RoomDiscussion({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<MessageOut[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [unauthenticated, setUnauthenticated] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retryCount, setRetryCount] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sendError, setSendError] = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const bottomRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const deletedIds = useRef(new Set<string>())
  const historyVersion = useRef(0)

  useEffect(() => {
    let cancelled = false
    let stopSocket: (() => void) | undefined
    async function refreshHistory() {
      const version = ++historyVersion.current
      const page = await getMessages(roomId, getAccessToken)
      if (!cancelled && version === historyVersion.current) {
        setMessages(mergeMessages(deletedIds.current, page.items))
        setNextCursor(page.next_cursor)
        setLoadError('')
      }
    }
    function onEvent(event: RoomEvent) {
      if (cancelled) return
      if (event.type === 'message.created')
        setMessages((previous) =>
          mergeMessages(deletedIds.current, previous, [event.message]),
        )
      else {
        deletedIds.current.add(event.message_id)
        setMessages((previous) =>
          previous.filter((message) => message.message_id !== event.message_id),
        )
      }
    }
    async function init() {
      try {
        const [user] = await Promise.all([
          getCurrentUser(getAccessToken),
          refreshHistory(),
        ])
        if (cancelled) return
        setCurrentUserId(user.user_id)
        setUnauthenticated(false)
        stopSocket = subscribeToRoom(roomId, getAccessToken, {
          onEvent,
          onReady: refreshHistory,
          onStatus: (status) => {
            if (!cancelled) setLiveStatus(status)
          },
          onUnauthorized: () => {
            if (!cancelled) setUnauthenticated(true)
          },
        })
      } catch (error) {
        if (cancelled) return
        setLiveStatus('unavailable')
        if (needsSignIn(error)) setUnauthenticated(true)
        else
          setLoadError(
            error instanceof ForumApiError && error.status === 422
              ? 'This room ID is invalid. Check the lecture link.'
              : 'Unable to load this discussion. Please retry.',
          )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void init()
    // Local expiry cleanup only: this does not poll the API.
    const expiry = setInterval(
      () =>
        setMessages((previous) => mergeMessages(deletedIds.current, previous)),
      15_000,
    )
    return () => {
      cancelled = true
      stopSocket?.()
      clearInterval(expiry)
    }
  }, [roomId, retryCount])

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView?.()
  }, [loading])

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return
    const version = historyVersion.current
    setLoadingOlder(true)
    setSendError('')
    try {
      const page = await getMessages(roomId, getAccessToken, nextCursor)
      if (version !== historyVersion.current) return
      setMessages((previous) =>
        mergeMessages(deletedIds.current, page.items, previous),
      )
      setNextCursor(page.next_cursor)
    } catch (error) {
      if (version !== historyVersion.current) return
      if (needsSignIn(error)) setUnauthenticated(true)
      else setSendError('Unable to load older messages. Try again.')
    } finally {
      setLoadingOlder(false)
    }
  }

  async function handleSend() {
    if (!content.trim() || content.length > MAX_CONTENT || sendingRef.current)
      return
    sendingRef.current = true
    setSending(true)
    setSendError('')
    try {
      const message = await postMessage(roomId, content.trim(), getAccessToken)
      setMessages((previous) =>
        mergeMessages(deletedIds.current, previous, [message]),
      )
      setContent('')
      bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' })
    } catch (error) {
      if (needsSignIn(error)) setUnauthenticated(true)
      else setSendError('Failed to send. Your draft is kept; please try again.')
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  async function handleDelete(messageId: string) {
    try {
      await deleteMessage(roomId, messageId, getAccessToken)
      deletedIds.current.add(messageId)
      setMessages((previous) =>
        previous.filter((message) => message.message_id !== messageId),
      )
    } catch (error) {
      if (needsSignIn(error)) setUnauthenticated(true)
      else if (error instanceof ForumApiError && error.status === 404) {
        deletedIds.current.add(messageId)
        setMessages((previous) =>
          previous.filter((message) => message.message_id !== messageId),
        )
      } else setSendError('Failed to delete message. Please try again.')
    }
  }

  function refresh() {
    setLoading(true)
    setLoadError('')
    setLiveStatus('connecting')
    setRetryCount((value) => value + 1)
  }

  async function login() {
    try {
      await startSignIn(`/forum/${encodeURIComponent(roomId)}`)
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : 'Unable to start sign-in.',
      )
    }
  }

  if (unauthenticated)
    return (
      <main className="forum-page">
        <h1>Lecture discussion</h1>
        <p>Sign in to view and post in this discussion.</p>
        <button onClick={() => void login()}>Sign in with NUS email</button>
        {sendError && <p role="alert">{sendError}</p>}
      </main>
    )

  return (
    <main className="forum-page">
      <header>
        <h1>Lecture discussion</h1>
        <p className="room-id">{roomId}</p>
      </header>
      <div className="forum-actions">
        <span role="status">
          {liveStatus === 'connected'
            ? 'Live updates connected'
            : liveStatus === 'unavailable'
              ? 'Live updates unavailable — use Refresh'
              : liveStatus === 'reconnecting'
                ? 'Reconnecting live updates…'
                : 'Connecting live updates…'}
        </span>
        <button className="secondary" onClick={refresh} disabled={loading}>
          Refresh
        </button>
        {currentUserId && (
          <button
            className="secondary"
            onClick={() => {
              void signOut().catch(() =>
                setSendError('Unable to finish sign-out.'),
              )
            }}
          >
            Sign out
          </button>
        )}
      </div>
      {nextCursor && (
        <button
          className="panel load-older"
          disabled={loadingOlder || loading}
          onClick={() => void loadOlder()}
        >
          {loadingOlder ? 'Loading…' : 'Load older messages'}
        </button>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : loadError ? (
        <p role="alert">
          {loadError} <button onClick={refresh}>Retry</button>
        </p>
      ) : messages.length === 0 ? (
        <p className="status-message">No messages yet. Be the first to post.</p>
      ) : (
        <div className="message-list">
          {messages.map((message) => {
            const own = message.author_id === currentUserId
            return (
              <article
                key={message.message_id}
                className={`message${own ? ' own' : ''}`}
              >
                <div className="message-header">
                  <span className="message-author">
                    {own ? 'You' : 'Student'}
                  </span>
                  <time className="message-time" dateTime={message.posted_at}>
                    {new Date(message.posted_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  {own && (
                    <button
                      className="message-delete"
                      onClick={() => void handleDelete(message.message_id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <p className="message-content">{message.content}</p>
              </article>
            )
          })}
        </div>
      )}
      <div ref={bottomRef} />
      <section className="panel composer">
        <label htmlFor="forum-message">Your message</label>
        <textarea
          id="forum-message"
          value={content}
          placeholder="Write a message…"
          onChange={(event) => {
            setContent(event.target.value)
            setSendError('')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void handleSend()
            }
          }}
          disabled={sending || loading || !!loadError}
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
              sending ||
              loading ||
              !!loadError ||
              !content.trim() ||
              content.length > MAX_CONTENT
            }
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        {sendError && <p role="alert">{sendError}</p>}
      </section>
    </main>
  )
}

export default function ForumPage() {
  const { roomId } = useParams<{ roomId: string }>()
  return roomId ? (
    <RoomDiscussion key={roomId} roomId={roomId} />
  ) : (
    <p>Select a lecture room.</p>
  )
}
