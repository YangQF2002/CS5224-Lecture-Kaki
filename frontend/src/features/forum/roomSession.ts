import { getLogoutVersion } from './auth.ts'
import { parseRoomId, roomPath } from './roomCatalogue.ts'

const PREFIX = 'lecturekaki:forum:'
const LAST_ROOM = `${PREFIX}last-room`
const LAST_PAGE = `${PREFIX}last-page`
const PICKER_PARAMS = `${PREFIX}picker-params`
const draftKey = (id: string) => `${PREFIX}draft:${id}`

function read(key: string): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (
      saved?.revision === getLogoutVersion() &&
      typeof saved.value === 'string'
    )
      return saved.value
    sessionStorage.removeItem(key)
  } catch {
    /* Browsing and posting still work if session persistence is unavailable. */
  }
  return null
}

function write(key: string, value: string) {
  try {
    if (!value) sessionStorage.removeItem(key)
    else
      sessionStorage.setItem(
        key,
        JSON.stringify({ revision: getLogoutVersion(), value }),
      )
  } catch {
    /* Keep the current page usable when storage is full or blocked. */
  }
}

export function lastRoom(): string | null {
  const id = read(LAST_ROOM)
  return id && parseRoomId(id) ? id : null
}

export function lastForumPath(): string | null {
  if (read(LAST_PAGE) === 'picker') {
    const params = new URLSearchParams(read(PICKER_PARAMS) ?? '')
    params.set('browse', '1')
    return `/forum?${params}`
  }
  const id = lastRoom()
  return id ? roomPath(id) : null
}

export function rememberPicker(params: URLSearchParams) {
  const saved = new URLSearchParams({ browse: '1' })
  for (const name of ['week', 'q']) {
    const value = params.get(name)
    if (value) saved.set(name, value)
  }
  write(PICKER_PARAMS, saved.toString())
  write(LAST_PAGE, 'picker')
}

export function rememberRoom(id: string) {
  if (parseRoomId(id)) {
    write(LAST_ROOM, id)
    write(LAST_PAGE, 'room')
  }
}

export function forgetRoom(id: string) {
  if (lastRoom() === id) write(LAST_ROOM, '')
}

export function readDraft(id: string): string {
  return read(draftKey(id)) ?? ''
}

export function saveDraft(id: string, content: string) {
  write(draftKey(id), content)
}

export function clearRoomSession() {
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(PREFIX)) sessionStorage.removeItem(key)
  } catch {
    /* Authentication is still cleared even if optional room state is blocked. */
  }
}
