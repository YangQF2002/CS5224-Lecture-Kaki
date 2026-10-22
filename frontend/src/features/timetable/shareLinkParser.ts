import { fetchModule } from './nusmodsApi.ts'
import type {
  Day,
  NusmodsModule,
  ParsedShareLink,
  RawLesson,
  Semester,
  ShareLessonReference,
  TimetableSelection,
  Weeks,
} from './types.ts'

const LESSON_TYPES: Record<string, string> = {
  DLEC: 'Design Lecture',
  LAB: 'Laboratory',
  LEC: 'Lecture',
  PLAB: 'Packaged Laboratory',
  PLEC: 'Packaged Lecture',
  PTUT: 'Packaged Tutorial',
  REC: 'Recitation',
  SEC: 'Sectional Teaching',
  SEM: 'Seminar-Style Module Class',
  TUT: 'Tutorial',
  TUT2: 'Tutorial Type 2',
  TUT3: 'Tutorial Type 3',
  WS: 'Workshop',
}

const ABBREVIATED_DAYS: Record<string, Day> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
}

const MODULE_CODE_PATTERN = /^[A-Z]{2,4}\s?\d{4}[A-Z0-9]{0,3}$/

function splitLessonConfiguration(value: string): string[] {
  const results: string[] = []
  let start = 0
  let parenthesisDepth = 0

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]

    if (character === '(') {
      parenthesisDepth += 1
    } else if (character === ')') {
      parenthesisDepth -= 1
    } else if (
      parenthesisDepth === 0 &&
      (character === ',' || character === ';')
    ) {
      results.push(value.slice(start, index))
      start = index + 1
    }
  }

  results.push(value.slice(start))
  return results.filter(Boolean)
}

function parseLessonReference(value: string): ShareLessonReference {
  const match = value.match(/^([A-Z0-9]+):(\((.*)\)|(.+))$/)

  if (!match) {
    throw new Error(`Invalid lesson selection: ${value}`)
  }

  const abbreviation = match[1]

  if (!LESSON_TYPES[abbreviation]) {
    throw new Error(`Unknown lesson type: ${abbreviation}`)
  }

  return {
    abbreviation,
    encodedValue: match[3] ?? match[4],
    wrapped: match[3] !== undefined,
  }
}

export function parseNusmodsShareLink(input: string): ParsedShareLink {
  let url: URL

  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Enter a valid NUSMods URL')
  }

  if (
    url.protocol !== 'https:' ||
    !['nusmods.com', 'www.nusmods.com'].includes(url.hostname)
  ) {
    throw new Error('The link must be an HTTPS nusmods.com URL')
  }

  const pathMatch = url.pathname.match(/^\/timetable\/sem-([1-4])\/share\/?$/)

  if (!pathMatch) {
    throw new Error('This is not a NUSMods timetable share link')
  }

  const semester = Number(pathMatch[1]) as Semester
  if (url.searchParams.get('ta')) {
    throw new Error('TA timetable imports are not supported')
  }
  const modules = []

  for (const [rawModuleCode, configuration] of url.searchParams.entries()) {
    if (rawModuleCode === 'hidden' || rawModuleCode === 'ta') {
      continue
    }

    const moduleCode = rawModuleCode.trim().toUpperCase()

    if (!MODULE_CODE_PATTERN.test(moduleCode)) {
      throw new Error(`Invalid module code in link: ${rawModuleCode}`)
    }

    const lessons = configuration
      ? splitLessonConfiguration(configuration).map(parseLessonReference)
      : []

    modules.push({ moduleCode, lessons })
  }

  if (modules.length === 0) {
    throw new Error('The share link contains no modules')
  }

  return { semester, modules }
}

function getSemesterTimetable(
  module: NusmodsModule,
  semester: Semester,
): RawLesson[] {
  const semesterData = module.semesterData.find(
    (entry) => entry.semester === semester,
  )

  if (!semesterData) {
    throw new Error(
      `${module.moduleCode} is not offered in semester ${semester}`,
    )
  }

  return semesterData.timetable
}

function serializeWeeks(weeks: Weeks): string {
  if (Array.isArray(weeks)) return weeks.length > 0 ? weeks.join('_') : '_'
  // NUSMods encodes an omitted interval as 0, although it means weekly.
  const range = [weeks.start, weeks.end, weeks.weekInterval ?? 0].join('_')
  return weeks.weeks === undefined
    ? range
    : `${range}_${serializeWeeks(weeks.weeks)}`
}

function lessonIdentifier(lesson: RawLesson): string {
  const day = Object.entries(ABBREVIATED_DAYS).find(
    ([, value]) => value === lesson.day,
  )?.[0]
  return [
    lesson.classNo,
    day,
    lesson.startTime,
    lesson.endTime,
    lesson.venue,
    serializeWeeks(lesson.weeks),
  ].join('|')
}

function resolveWrappedReference(
  reference: ShareLessonReference,
  timetable: RawLesson[],
  lessonType: string,
): string {
  const identifiers = reference.encodedValue
    .split(',')
    .map((identifier) => identifier.trim())
    .filter(Boolean)

  if (identifiers.length === 0) {
    throw new Error(`No class specified for ${lessonType}`)
  }

  // V2 uses timetable indexes; V3 uses complete lesson details, including weeks.
  const matchedLessons = identifiers.map((identifier) => {
    const lesson = /^\d+$/.test(identifier)
      ? timetable[Number(identifier)]
      : timetable.find(
          (candidate) =>
            candidate.lessonType === lessonType &&
            lessonIdentifier(candidate) === identifier,
        )

    if (!lesson || lesson.lessonType !== lessonType) {
      throw new Error(`Stale ${lessonType} selection`)
    }

    return lesson
  })

  const classNumbers = new Set(matchedLessons.map((lesson) => lesson.classNo))

  if (classNumbers.size !== 1) {
    throw new Error(`The ${lessonType} selection is inconsistent`)
  }

  // Restoring a class number expands every occurrence, so the link must contain the whole group.
  const currentGroup = timetable.filter(
    (lesson) =>
      lesson.lessonType === lessonType &&
      lesson.classNo === matchedLessons[0].classNo,
  )
  if (
    currentGroup.length !== matchedLessons.length ||
    currentGroup.some((lesson) => !matchedLessons.includes(lesson))
  ) {
    throw new Error(`Stale ${lessonType} selection`)
  }

  return matchedLessons[0].classNo
}

function resolveClassNumber(
  reference: ShareLessonReference,
  timetable: RawLesson[],
): { lessonType: string; classNo: string } {
  const lessonType = LESSON_TYPES[reference.abbreviation]
  const classNo = reference.wrapped
    ? resolveWrappedReference(reference, timetable, lessonType)
    : reference.encodedValue

  const exists = timetable.some(
    (lesson) => lesson.lessonType === lessonType && lesson.classNo === classNo,
  )

  if (!exists) {
    throw new Error(`Class ${lessonType} ${classNo} no longer exists`)
  }

  return { lessonType, classNo }
}

export async function resolveImportedTimetable(
  shareLink: ParsedShareLink,
  academicYear: string,
): Promise<{
  selections: TimetableSelection[]
  warnings: string[]
}> {
  const selections: TimetableSelection[] = []
  const warnings: string[] = []

  await Promise.all(
    shareLink.modules.map(async (moduleReference) => {
      try {
        const module = await fetchModule(
          academicYear,
          moduleReference.moduleCode,
        )
        const timetable = getSemesterTimetable(module, shareLink.semester)

        if (moduleReference.lessons.length === 0) {
          warnings.push(
            `${module.moduleCode} contains no selected lesson groups`,
          )
          return
        }

        for (const reference of moduleReference.lessons) {
          const { lessonType, classNo } = resolveClassNumber(
            reference,
            timetable,
          )

          selections.push({
            moduleCode: module.moduleCode,
            moduleTitle: module.title,
            lessonType,
            classNo,
          })
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown import error'
        warnings.push(`${moduleReference.moduleCode}: ${message}`)
      }
    }),
  )

  return {
    selections: selections.sort((left, right) =>
      left.moduleCode.localeCompare(right.moduleCode),
    ),
    warnings,
  }
}
