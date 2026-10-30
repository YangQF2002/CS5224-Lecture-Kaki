// prettier-ignore
import { ForumApiError, needsSignIn, getConnectionTicket, forumSocketUrl, type MessageOut } from './forumApi.ts'

export type RoomEvent =
  | { type: 'message.created'; room_id: string; message: MessageOut }
  | { type: 'message.deleted'; room_id: string; message_id: string }

export type LiveStatus =
  'connecting' | 'connected' | 'reconnecting' | 'unavailable'

interface Handlers {
  onEvent: (event: RoomEvent) => void
  onStatus: (status: LiveStatus) => void
  onReady: () => Promise<void>
  onUnauthorized: () => void
}

export function subscribeToRoom(
  roomId: string,
  getToken: () => Promise<string>,
  handlers: Handlers,
): () => void {
  let stopped = false
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let clearConnectionTimers = () => {}
  let failures = 0

  function reconnect(status: LiveStatus = 'reconnecting') {
    if (stopped || retry !== undefined) return
    handlers.onStatus(status)
    retry = setTimeout(
      () => {
        retry = undefined
        void connect()
      },
      Math.min(1000 * 2 ** failures++, 30_000),
    )
  }

  async function connect() {
    if (stopped) return
    try {
      const ticket = await getConnectionTicket(roomId, getToken)
      if (stopped) return
      const current = new WebSocket(forumSocketUrl(ticket.path))
      socket = current
      let ready = false
      const pending: RoomEvent[] = []
      current.onmessage = (message) => {
        if (stopped || socket !== current) return
        try {
          const event = JSON.parse(String(message.data)) as RoomEvent
          if (
            event.room_id !== roomId ||
            !['message.created', 'message.deleted'].includes(event.type)
          )
            return
          if (event.type === 'message.created' && !event.message?.message_id)
            return
          if (
            event.type === 'message.deleted' &&
            typeof event.message_id !== 'string'
          )
            return
          if (ready) handlers.onEvent(event)
          else pending.push(event)
        } catch {
          /* Ignore malformed events; stored history remains authoritative. */
        }
      }
      let rotate: ReturnType<typeof setTimeout> | undefined
      let ping: ReturnType<typeof setInterval> | undefined
      const clearTimers = () => {
        clearTimeout(rotate)
        clearInterval(ping)
      }
      clearConnectionTimers()
      clearConnectionTimers = clearTimers
      current.onopen = () => {
        if (stopped || socket !== current) return
        void handlers
          .onReady()
          .then(() => {
            if (
              stopped ||
              socket !== current ||
              current.readyState !== WebSocket.OPEN
            )
              return
            failures = 0
            ready = true
            pending.forEach(handlers.onEvent)
            handlers.onStatus('connected')
          })
          .catch((error: unknown) => {
            if (stopped || socket !== current) return
            if (needsSignIn(error)) {
              stopped = true
              handlers.onUnauthorized()
            }
            current.close()
          })
        // Rotate before the authenticated session expires; getToken refreshes it.
        rotate = setTimeout(
          () => {
            current.close(1000, 'Refresh session')
          },
          Math.max(1000, ticket.session_expires_at * 1000 - Date.now() - 5000),
        )
        ping = setInterval(() => {
          if (current.readyState === WebSocket.OPEN)
            current.send(JSON.stringify({ action: 'ping' }))
        }, 4 * 60_000)
      }
      current.onerror = () => {
        current.close()
      }
      current.onclose = () => {
        clearTimers()
        if (socket === current) reconnect()
      }
    } catch (error) {
      if (stopped) return
      if (needsSignIn(error)) {
        stopped = true
        handlers.onUnauthorized()
      } else if (error instanceof ForumApiError && error.status === 503) {
        reconnect('unavailable')
      } else reconnect()
    }
  }

  handlers.onStatus('connecting')
  void connect()
  return () => {
    stopped = true
    clearTimeout(retry)
    clearConnectionTimers()
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
    }
  }
}
