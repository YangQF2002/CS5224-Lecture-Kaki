export type Semester = 1 | 2 | 3 | 4

export type Day =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday'

export type WeekRange = {
  start: string
  end: string
  weekInterval?: number
  weeks?: number[]
}

export type Weeks = number[] | WeekRange

export type ModuleSummary = {
  moduleCode: string
  title: string
  semesters: number[]
}

export type RawLesson = {
  classNo: string
  day: Day
  startTime: string
  endTime: string
  lessonType: string
  venue: string
  weeks: Weeks
}

export type SemesterData = {
  semester: Semester
  timetable: RawLesson[]
}

export type NusmodsModule = {
  moduleCode: string
  title: string
  semesterData: SemesterData[]
}

export type TimetableSelection = {
  moduleCode: string
  moduleTitle: string
  lessonType: string
  classNo: string
  day?: Day
  week?: number
  source?: 'discover'
}

export type TimetableLesson = RawLesson & {
  moduleCode: string
  moduleTitle: string
  selectedWeek?: number
}

export type TimetableState = {
  academicYear: string
  semester: Semester
  selections: TimetableSelection[]
  semesterSelections?: Partial<Record<Semester, TimetableSelection[]>>
}

export type TimetableBook = {
  academicYear: string
  semesters: Record<Semester, TimetableSelection[]>
}

export type ShareLessonReference = {
  abbreviation: string
  encodedValue: string
  wrapped: boolean
}

export type ShareModuleReference = {
  moduleCode: string
  lessons: ShareLessonReference[]
}

export type ParsedShareLink = {
  semester: Semester
  modules: ShareModuleReference[]
}
