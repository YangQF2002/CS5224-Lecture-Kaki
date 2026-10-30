import {
  fetchLectureSnapshot,
  fetchWeekSessions,
} from '../discovery/lectureApi.ts'
import type { LecturePointer, LectureSession } from '../discovery/types.ts'

const ROOM_PATTERN =
  /^([A-Z0-9]+-LEC-[A-Za-z0-9.]+)@(\d{4}-\d{2}-\d{2})-([01]\d|2[0-3])([0-5]\d)-[\w./-]+@(\d{4})-(\d{4})@([1-4])$/

export function parseRoomId(id: string) {
  const match = ROOM_PATTERN.exec(id)
  if (!match || Number(match[6]) !== Number(match[5]) + 1) return null
  const date = new Date(`${match[2]}T00:00:00Z`)
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.toISOString().slice(0, 10) !== match[2] ||
    Number(match[5]) < 1
  )
    return null
  return {
    id,
    date: match[2],
    sessionId: id.split('@').slice(0, 2).join('@'),
    acadYear: `${match[5]}-${match[6]}`,
    semester: Number(match[7]),
  }
}

export function roomIdFor(session: LectureSession, pointer: LecturePointer) {
  return `${session.id}@${pointer.acadYear}@${pointer.semester}`
}

export function roomPath(id: string) {
  return `/forum/${encodeURIComponent(id)}`
}

export function roomFromLink(value: string): string | null {
  let id = value.trim()
  if (/^https?:\/\//.test(id) || id.startsWith('/forum/')) {
    try {
      const url = new URL(id, 'https://local.invalid')
      if (!['https:', 'http:'].includes(url.protocol)) return null
      const match = /^\/forum\/(.+)$/.exec(url.pathname)
      if (!match) return null
      id = decodeURIComponent(match[1])
    } catch {
      return null
    }
  }
  return parseRoomId(id)?.id ?? null
}

export class RoomNotFound extends Error {}
export type LectureRoom = {
  id: string
  session: LectureSession
  pointer: LecturePointer
}

export async function resolveRoom(id: string): Promise<LectureRoom> {
  const parsed = parseRoomId(id)
  if (!parsed)
    throw new RoomNotFound(
      'This discussion link is invalid. Choose a lecture to open its discussion.',
    )
  const snapshot = await fetchLectureSnapshot()
  if (
    parsed.acadYear !== snapshot.pointer.acadYear ||
    parsed.semester !== snapshot.pointer.semester
  )
    throw new RoomNotFound(
      'This lecture belongs to a different term. Choose a lecture from the current list.',
    )
  const week = snapshot.index.weeks.find(
    (week) => week.startDate <= parsed.date && parsed.date <= week.endDate,
  )
  if (!week)
    throw new RoomNotFound('This lecture is not in the current lecture list.')
  const data = await fetchWeekSessions(snapshot.pointer, week.week)
  const session = data.sessions.find(
    (session) => session.id === parsed.sessionId,
  )
  if (!session)
    throw new RoomNotFound('This lecture is not in the current lecture list.')
  return { id, session, pointer: snapshot.pointer }
}

export function lectureDate(date: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

export function lectureTime(time: string): string {
  return time.replace(/^(\d{2})(\d{2})$/, '$1:$2')
}
