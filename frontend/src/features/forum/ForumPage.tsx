import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
// prettier-ignore
import { confirmSignedIn, getAccessToken, signOut, startSignIn, subscribeToSignOut, tryAutomaticSignIn } from './auth.ts'
// prettier-ignore
import { deleteMessage, ForumApiError, getCurrentUser, getMessages, needsSignIn, type MessageOut } from './forumApi.ts'
// prettier-ignore
import { subscribeToRoom, type LiveStatus, type RoomEvent } from './forumSocket.ts'
// prettier-ignore
import { lectureDate, lectureTime, resolveRoom, RoomNotFound, roomPath, type LectureRoom } from './roomCatalogue.ts'
import { clearRoomSession, forgetRoom, rememberRoom } from './roomSession.ts'
import ForumComposer from './ForumComposer.tsx'
import ForumLayout from './ForumLayout.tsx'
import PdfAttachment from './PdfAttachment.tsx'
import { downloadPdf } from './forumPdf.ts'
import './forum.css'

const LIVE_LABELS: Record<LiveStatus, string> = {
  connecting: 'Connecting live updates…',
  connected: 'Live updates connected',
  reconnecting: 'Reconnecting live updates…',
  unavailable: 'Live updates unavailable — use Refresh',
}

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
  const [shareStatus, setShareStatus] = useState('')
  const downloadController = useRef<AbortController | null>(null)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const bottomRef = useRef<HTMLDivElement>(null)
  const deletedIds = useRef(new Set<string>())
  const historyVersion = useRef(0)
  const interactionVersion = useRef(0)
  const pendingHistory = useRef(new Set<Map<string, MessageOut>>())
  const discussionLink = `${location.origin}${roomPath(roomId)}`

  function addMessage(message: MessageOut) {
    for (const arrived of pendingHistory.current)
      arrived.set(message.message_id, message)
    setMessages((previous) =>
      mergeMessages(deletedIds.current, previous, [message]),
    )
  }

  function removeMessage(messageId: string) {
    deletedIds.current.add(messageId)
    setMessages((previous) =>
      previous.filter((message) => message.message_id !== messageId),
    )
  }

  useEffect(
    () => () => {
      interactionVersion.current += 1
      downloadController.current?.abort()
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
      downloadController.current?.abort()
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
      if (event.type === 'message.created') addMessage(event.message)
      else removeMessage(event.message_id)
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

  async function handleDelete(messageId: string) {
    const version = interactionVersion.current
    try {
      await deleteMessage(roomId, messageId, getAccessToken)
      if (version !== interactionVersion.current) return
      removeMessage(messageId)
    } catch (error) {
      if (version !== interactionVersion.current) return
      if (needsSignIn(error)) setUnauthenticated(true)
      else if (error instanceof ForumApiError && error.status === 404) {
        removeMessage(messageId)
      } else setSendError('Failed to delete message. Please try again.')
    }
  }

  async function handleDownload(message: MessageOut) {
    if (!message.attachment) return
    const version = interactionVersion.current
    downloadController.current?.abort()
    const controller = new AbortController()
    downloadController.current = controller
    setSendError('')
    try {
      await downloadPdf(
        roomId,
        message.message_id,
        message.attachment.filename,
        getAccessToken,
        controller.signal,
      )
    } catch (error) {
      if (version !== interactionVersion.current || controller.signal.aborted)
        return
      if (needsSignIn(error)) setUnauthenticated(true)
      else
        setSendError(
          error instanceof Error ? error.message : 'Unable to download PDF.',
        )
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
      <ForumLayout>
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
      </ForumLayout>
    )

  return (
    <ForumLayout onReopen={loadError ? refresh : undefined}>
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
        <span role="status">{LIVE_LABELS[liveStatus]}</span>
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
                {message.content && (
                  <p className="message-content">{message.content}</p>
                )}
                {message.attachment && (
                  <PdfAttachment
                    filename={message.attachment.filename}
                    size={message.attachment.size}
                    action="download"
                    onAction={() => void handleDownload(message)}
                  />
                )}
              </article>
            )
          })}
        </div>
      )}
      <div ref={bottomRef} />
      <ForumComposer
        roomId={roomId}
        disabled={loading || !!loadError || !currentUserId}
        error={sendError}
        onError={setSendError}
        onSignInRequired={() => setUnauthenticated(true)}
        onSent={(message) => {
          addMessage(message)
          bottomRef.current?.scrollIntoView?.({
            behavior: 'smooth',
            block: 'nearest',
          })
        }}
      />
    </ForumLayout>
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
  function retryRoom() {
    setError('')
    setRetry((value) => value + 1)
  }

  if (room) return <RoomDiscussion room={room} />
  return (
    <ForumLayout onReopen={retryRoom}>
      <h1>{error ? 'Discussion unavailable' : 'Opening discussion'}</h1>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <p>
            <Link to="/forum?browse=1">Choose a lecture</Link>
          </p>
          <button className="secondary" onClick={retryRoom}>
            Retry
          </button>
        </>
      ) : (
        <p role="status">Checking lecture details…</p>
      )}
    </ForumLayout>
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
    <ForumLayout>
      <Link to="/forum?browse=1">Choose a lecture</Link>
    </ForumLayout>
  )
}
