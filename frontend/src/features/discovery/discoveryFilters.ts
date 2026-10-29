import type { LectureModule, LectureSession, LectureWeek } from './types.ts'

export type DiscoveryFilters = {
  week: string | null
  days: string[]
  from: string
  to: string
  buildings: string[]
  codes: string[]
  faculties: string[]
  levels: number[]
  minSize: number
  query: string
  includeOnline: boolean
}

// Selects in-person sessions whose venue has no known building.
export const OTHER_VENUES = 'other'

export const DEFAULT_FROM = '08:00'
export const DEFAULT_TO = '22:00'

export const DEFAULT_FILTERS: DiscoveryFilters = {
  week: null,
  days: [],
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  buildings: [],
  codes: [],
  faculties: [],
  levels: [],
  minSize: 0,
  query: '',
  includeOnline: false,
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function readList(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function readTime(params: URLSearchParams, key: string, fallback: string) {
  const value = params.get(key) ?? ''
  return TIME_PATTERN.test(value) ? value : fallback
}

export function parseFilters(params: URLSearchParams): DiscoveryFilters {
  const minSize = Number(params.get('minSize'))

  return {
    week: params.get('week') || null,
    days: readList(params, 'days').filter((day) => DATE_PATTERN.test(day)),
    from: readTime(params, 'from', DEFAULT_FROM),
    to: readTime(params, 'to', DEFAULT_TO),
    buildings: readList(params, 'buildings'),
    codes: readList(params, 'codes').map((code) => code.toUpperCase()),
    faculties: readList(params, 'faculties'),
    levels: readList(params, 'levels')
      .map(Number)
      .filter((level) => Number.isInteger(level) && level > 0),
    minSize: Number.isInteger(minSize) && minSize > 0 ? minSize : 0,
    query: params.get('q')?.trim() ?? '',
    includeOnline: params.get('online') === '1',
  }
}

// Omits defaults so shared links stay short.
export function filtersToParams(filters: DiscoveryFilters): URLSearchParams {
  const params = new URLSearchParams()
  const lists: [string, (string | number)[]][] = [
    ['days', filters.days],
    ['buildings', filters.buildings],
    ['codes', filters.codes],
    ['faculties', filters.faculties],
    ['levels', filters.levels],
  ]

  if (filters.week) params.set('week', filters.week)
  for (const [key, values] of lists) {
    if (values.length > 0) params.set(key, values.join(','))
  }
  if (filters.from !== DEFAULT_FROM) params.set('from', filters.from)
  if (filters.to !== DEFAULT_TO) params.set('to', filters.to)
  if (filters.minSize > 0) params.set('minSize', String(filters.minSize))
  if (filters.query) params.set('q', filters.query)
  if (filters.includeOnline) params.set('online', '1')

  return params
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function fromMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function codePrefix(moduleCode: string): string {
  return /^[A-Z]+/.exec(moduleCode)?.[0] ?? moduleCode
}

export function buildSearchText(modules: LectureModule[]): Map<string, string> {
  return new Map(
    modules.map((module) => [
      module.moduleCode,
      [module.moduleCode, module.title, module.description ?? '']
        .join(' ')
        .toLowerCase(),
    ]),
  )
}

export function filterSessions(
  sessions: LectureSession[],
  filters: DiscoveryFilters,
  searchText: Map<string, string>,
): LectureSession[] {
  const from = toMinutes(filters.from)
  const to = toMinutes(filters.to)
  const days = new Set(filters.days)
  const buildings = new Set(filters.buildings)
  const codes = new Set(filters.codes)
  const faculties = new Set(filters.faculties)
  const levels = new Set(filters.levels)
  const terms = filters.query.toLowerCase().split(/\s+/).filter(Boolean)

  return sessions.filter((session) => {
    if (session.online && !filters.includeOnline) return false
    if (days.size > 0 && !days.has(session.date)) return false
    if (toMinutes(session.startTime) < from) return false
    if (toMinutes(session.endTime) > to) return false
    if (session.size < filters.minSize) return false
    if (buildings.size > 0 && !session.online) {
      const building = session.building ?? OTHER_VENUES
      if (!buildings.has(building)) return false
    }
    if (
      codes.size > 0 &&
      ![session.moduleCode, ...session.crossListed].some((code) =>
        codes.has(codePrefix(code)),
      )
    ) {
      return false
    }
    if (faculties.size > 0 && !faculties.has(session.faculty)) return false
    if (
      levels.size > 0 &&
      (session.level === null || !levels.has(session.level))
    ) {
      return false
    }
    if (terms.length > 0) {
      const text =
        searchText.get(session.moduleCode) ??
        `${session.moduleCode} ${session.moduleTitle}`.toLowerCase()
      if (!terms.every((term) => text.includes(term))) return false
    }
    return true
  })
}

export function singaporeNow(date = new Date()): {
  date: string
  minutes: number
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

// The week containing today, else the next week with lectures, else the last.
export function chooseDefaultWeek(
  weeks: LectureWeek[],
  today: string,
): string | null {
  const current = weeks.find(
    (week) => week.startDate <= today && today <= week.endDate,
  )
  const upcoming = weeks.find((week) => week.startDate > today)

  return (current ?? upcoming ?? weeks.at(-1))?.week ?? null
}

export function weekName(week: string): string {
  const teaching = /^week-(\d+)$/.exec(week)
  if (teaching) return `Week ${Number(teaching[1])}`
  const exam = /^exam-(\d+)$/.exec(week)
  if (exam) return `Exam week ${exam[1]}`
  if (week === 'recess') return 'Recess week'
  if (week === 'reading') return 'Reading week'
  return week
}
