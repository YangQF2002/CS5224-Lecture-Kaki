// Shapes of the static lecture snapshot; see docs/architecture.md.

export type LecturePointer = {
  generatedAt: string
  acadYear: string
  semester: number
  path: string
}

export type LectureWeek = {
  week: string
  startDate: string
  endDate: string
  sessionCount: number
}

export type LectureIndex = {
  generatedAt: string
  acadYear: string
  semester: number
  sessionCount: number
  days: string[]
  weeks: LectureWeek[]
}

export type LectureSession = {
  id: string
  moduleCode: string
  crossListed: string[]
  moduleTitle: string
  faculty: string
  department: string
  level: number | null
  lessonType: string
  classNo: string
  date: string
  startTime: string
  endTime: string
  venue: string
  building: string | null
  online: boolean
  size: number
}

export type LectureModule = {
  moduleCode: string
  title: string
  faculty: string
  department: string
  level: number | null
  moduleCredit: string | null
  description: string | null
}

export type WeekSessions = {
  week: string
  startDate: string
  endDate: string
  sessions: LectureSession[]
}

export type LectureSnapshot = {
  pointer: LecturePointer
  index: LectureIndex
  modules: LectureModule[]
}
