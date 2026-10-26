import type {
  LectureIndex,
  LectureModule,
  LecturePointer,
  LectureSnapshot,
  WeekSessions,
} from './types.ts'

// Lecture data is served from the same origin as the app.
const POINTER_URL = '/lectures/current.json'

// Snapshot files never change once published, so they can be reused.
const snapshotCache = new Map<string, Promise<unknown>>()

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)

  if (!response.ok) {
    throw new Error(`Lecture data returned HTTP ${response.status}`)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new Error('Lecture data is not valid JSON')
  }
}

function fetchSnapshotFile<T>(url: string): Promise<T> {
  let request = snapshotCache.get(url)

  if (!request) {
    request = fetchJson<T>(url)
    // Allow a retry after a failed request.
    request.catch(() => snapshotCache.delete(url))
    snapshotCache.set(url, request)
  }

  return request as Promise<T>
}

export async function fetchLectureSnapshot(): Promise<LectureSnapshot> {
  const pointer = await fetchJson<LecturePointer>(POINTER_URL, {
    cache: 'no-cache',
  })
  const base = `/${pointer.path}`
  const [index, modules] = await Promise.all([
    fetchSnapshotFile<LectureIndex>(`${base}index.json`),
    fetchSnapshotFile<{ items: LectureModule[] }>(`${base}modules.json`),
  ])

  return { pointer, index, modules: modules.items }
}

export function fetchWeekSessions(
  pointer: LecturePointer,
  week: string,
): Promise<WeekSessions> {
  return fetchSnapshotFile<WeekSessions>(
    `/${pointer.path}weeks/${encodeURIComponent(week)}.json`,
  )
}
