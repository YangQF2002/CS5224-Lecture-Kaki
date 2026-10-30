import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  confirmSignedIn,
  getAccessToken,
  signOut,
  startSignIn,
  subscribeToSignOut,
  tryAutomaticSignIn,
} from './auth.ts'
import {
  deleteMessage,
  ForumApiError,
  getCurrentUser,
  getMessages,
  needsSignIn,
  postMessage,
  type MessageOut,
} from './forumApi.ts'
import {
  subscribeToRoom,
  type LiveStatus,
  type RoomEvent,
} from './forumSocket.ts'
import {
  lectureDate,
  lectureTime,
  resolveRoom,
  RoomNotFound,
  roomPath,
  type LectureRoom,
} from './roomCatalogue.ts'
import {
  clearRoomSession,
  forgetRoom,
  readDraft,
  rememberRoom,
  saveDraft,
} from './roomSession.ts'
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

function DiscussionHeading({ room }: { room: LectureRoom }) {
  const { session } = room
  return (
    <>
      <p>
        <Link to="/forum?browse=1">Choose another lecture</Link>
      </p>
      <header>
        <h1>{session.moduleCode} discussion</h1>
        <p>{session.moduleTitle}</p>
        <p>
          {lectureDate(session.date)} · {lectureTime(session.startTime)}–
          {lectureTime(session.endTime)} · {session.venue}
        </p>
      </header>
    </>
  )
}

function RoomDiscussion({ room }: { room: LectureRoom }) {
  const roomId = room.id
  const [messages, setMessages] = useState<MessageOut[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [unauthenticated, setUnauthenticated] = useState(false)
  const [restoringSignIn, setRestoringSignIn] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retryCount, setRetryCount] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sendError, setSendError] = useState('')
  const [content, setContent] = useState(() => readDraft(roomId))
  const [shareStatus, setShareStatus] = useState('')
  const [sending, setSending] = useState(false)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const bottomRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const deletedIds = useRef(new Set<string>())
  const historyVersion = useRef(0)
  const interactionVersion = useRef(0)
  const pendingHistory = useRef(new Set<Map<string, MessageOut>>())
  const characterCount = Array.from(content).length
  const composerDisabled =
    sending || loading || !!loadError || unauthenticated || !currentUserId
  const canSend =
    !composerDisabled && !!content.trim() && characterCount <= MAX_CONTENT
  const discussionLink = `${location.origin}${roomPath(roomId)}`

  useEffect(
    () => () => {
      interactionVersion.current += 1
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    const signInController = new AbortController()
    let stopSocket: (() => void) | undefined
    const stopSignOut = subscribeToSignOut(() => {
      cancelled = true
      signInController.abort()
      historyVersion.current += 1
      interactionVersion.current += 1
      clearRoomSession()
      setSendError('')
      setContent('')
      stopSocket?.()
      setMessages([])
      setCurrentUserId(null)
      setUnauthenticated(true)
      setRestoringSignIn(false)
      setLoading(false)
    })
    async function refreshHistory() {
      const version = ++historyVersion.current
      // A history read can finish after a newer socket event or POST response.
      const arrived = new Map<string, MessageOut>()
      pendingHistory.current.add(arrived)
      try {
        const page = await getMessages(roomId, getAccessToken)
        if (!cancelled && version === historyVersion.current) {
          setMessages(
            mergeMessages(deletedIds.current, page.items, [
              ...arrived.values(),
            ]),
          )
          setNextCursor(page.next_cursor)
          setLoadError('')
          setLoadingOlder(false)
        }
      } finally {
        pendingHistory.current.delete(arrived)
      }
    }
    function onEvent(event: RoomEvent) {
      if (cancelled) return
      if (event.type === 'message.created') {
        for (const arrived of pendingHistory.current)
          arrived.set(event.message.message_id, event.message)
        setMessages((previous) =>
          mergeMessages(deletedIds.current, previous, [event.message]),
        )
      } else {
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
        confirmSignedIn()
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
        // Discard a sibling history request that outlives this failed load.
        historyVersion.current += 1
        setLiveStatus('unavailable')
        if (needsSignIn(error)) {
          setUnauthenticated(true)
          setRestoringSignIn(true)
          try {
            const started = await tryAutomaticSignIn(
              roomPath(roomId),
              signInController.signal,
            )
            if (!cancelled) setRestoringSignIn(started)
          } catch (reason) {
            if (!cancelled) {
              setRestoringSignIn(false)
              setSendError(
                reason instanceof Error
                  ? reason.message
                  : 'Unable to restore sign-in.',
              )
            }
          }
        } else
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
    return () => {
      cancelled = true
      historyVersion.current += 1
      signInController.abort()
      stopSignOut()
      stopSocket?.()
    }
  }, [roomId, retryCount])

  // Schedule local removal at the next message expiry; no API polling.
  useEffect(() => {
    const nextExpiry = Math.min(
      ...messages.map((message) => Date.parse(message.expires_at)),
    )
    if (!Number.isFinite(nextExpiry)) return
    const timer = setTimeout(
      () => {
        setMessages((previous) => mergeMessages(deletedIds.current, previous))
      },
      Math.max(0, nextExpiry - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [messages])

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
      if (version === historyVersion.current) setLoadingOlder(false)
    }
  }

  async function handleSend() {
    if (!canSend || sendingRef.current) return
    const version = interactionVersion.current
    sendingRef.current = true
    setSending(true)
    setSendError('')
    try {
      const message = await postMessage(roomId, content.trim(), getAccessToken)
      if (version !== interactionVersion.current) return
      for (const arrived of pendingHistory.current)
        arrived.set(message.message_id, message)
      setMessages((previous) =>
        mergeMessages(deletedIds.current, previous, [message]),
      )
      if (readDraft(roomId) === content) saveDraft(roomId, '')
      setContent('')
      bottomRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest',
      })
    } catch (error) {
      if (version !== interactionVersion.current) return
      if (needsSignIn(error)) setUnauthenticated(true)
      else setSendError('Failed to send. Your draft is kept; please try again.')
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  async function handleDelete(messageId: string) {
    const version = interactionVersion.current
    try {
      await deleteMessage(roomId, messageId, getAccessToken)
      if (version !== interactionVersion.current) return
      deletedIds.current.add(messageId)
      setMessages((previous) =>
        previous.filter((message) => message.message_id !== messageId),
      )
    } catch (error) {
      if (version !== interactionVersion.current) return
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

  async function copyLink() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(discussionLink)
      setShareStatus('copied')
    } catch {
      setShareStatus('manual')
    }
  }

  async function login() {
    try {
      await startSignIn(roomPath(roomId))
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : 'Unable to start sign-in.',
      )
    }
  }

  if (unauthenticated)
    return (
      <main className="forum-page">
        <DiscussionHeading room={room} />
        <p role={restoringSignIn ? 'status' : undefined}>
          {restoringSignIn
            ? 'Restoring sign-in with Cognito…'
            : 'Sign in to view and post in this discussion.'}
        </p>
        <button onClick={() => void login()} disabled={restoringSignIn}>
          Sign in with NUS email
        </button>
        {sendError && <p role="alert">{sendError}</p>}
      </main>
    )

  return (
    <main className="forum-page">
      <DiscussionHeading room={room} />
      <div className="forum-share">
        <button className="secondary" onClick={() => void copyLink()}>
          Copy discussion link
        </button>
        {shareStatus === 'copied' && (
          <span role="status">Discussion link copied.</span>
        )}
        {shareStatus === 'manual' && (
          <label>
            Copy this discussion link
            <input
              readOnly
              value={discussionLink}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        )}
      </div>
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
            saveDraft(roomId, event.target.value)
            setSendError('')
          }}
          onKeyDown={(event) => {
            if (
              !event.nativeEvent.isComposing &&
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey)
            ) {
              event.preventDefault()
              void handleSend()
            }
          }}
          disabled={composerDisabled}
        />
        <p className="forum-compose-hint">
          Ctrl/Cmd + Enter to send. Your unsent draft stays in this tab.
        </p>
        <div className="composer-footer">
          <span
            className={`char-count${characterCount > MAX_CONTENT ? ' over' : ''}`}
          >
            {characterCount}/{MAX_CONTENT}
          </span>
          <button onClick={() => void handleSend()} disabled={!canSend}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        {sendError && <p role="alert">{sendError}</p>}
      </section>
    </main>
  )
}

function ValidatedDiscussion({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<LectureRoom | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    resolveRoom(roomId).then(
      (result) => {
        if (!cancelled) {
          rememberRoom(result.id)
          setRoom(result)
        }
      },
      (reason: unknown) => {
        if (cancelled) return
        if (reason instanceof RoomNotFound) forgetRoom(roomId)
        setError(
          reason instanceof RoomNotFound
            ? reason.message
            : 'We couldn’t load the lecture details. Please try again.',
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [roomId, retry])
  if (room) return <RoomDiscussion room={room} />
  return (
    <main className="forum-page">
      <h1>{error ? 'Discussion unavailable' : 'Opening discussion'}</h1>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <p>
            <Link to="/forum?browse=1">Choose a lecture</Link>
          </p>
          <button
            className="secondary"
            onClick={() => {
              setError('')
              setRetry((value) => value + 1)
            }}
          >
            Retry
          </button>
        </>
      ) : (
        <p role="status">Checking lecture details…</p>
      )}
    </main>
  )
}

export default function ForumPage() {
  const { roomId } = useParams<{ roomId: string }>()
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [roomId])
  return roomId ? (
    <ValidatedDiscussion key={roomId} roomId={roomId} />
  ) : (
    <main className="forum-page">
      <Link to="/forum?browse=1">Choose a lecture</Link>
    </main>
  )
}
