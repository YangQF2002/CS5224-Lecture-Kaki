import type { ModuleSummary, NusmodsModule } from './types.ts'

const API_BASE_URL = 'https://api.nusmods.com/v2'

const moduleCache = new Map<string, NusmodsModule>()

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`NUSMods returned HTTP ${response.status}`)
  }

  return (await response.json()) as T
}

export function getCurrentAcademicYear(date = new Date()): string {
  const calendarYear = date.getFullYear()
  // NUS academic years begin in August.
  const academicYearStart =
    date.getMonth() >= 7 ? calendarYear : calendarYear - 1

  return `${academicYearStart}-${academicYearStart + 1}`
}

export function isAcademicYear(value: string): boolean {
  const match = /^(\d{4})-(\d{4})$/.exec(value)
  return match !== null && Number(match[2]) === Number(match[1]) + 1
}

export function getDefaultSemester(date = new Date()): 1 | 2 {
  return date.getMonth() >= 7 ? 1 : 2
}

export function fetchModuleList(
  academicYear: string,
): Promise<ModuleSummary[]> {
  return fetchJson<ModuleSummary[]>(
    `${API_BASE_URL}/${academicYear}/moduleList.json`,
  )
}

export async function fetchModule(
  academicYear: string,
  moduleCode: string,
): Promise<NusmodsModule> {
  const normalizedCode = moduleCode.trim().toUpperCase()
  const cacheKey = `${academicYear}:${normalizedCode}`
  const cachedModule = moduleCache.get(cacheKey)

  if (cachedModule) {
    return cachedModule
  }

  const module = await fetchJson<NusmodsModule>(
    `${API_BASE_URL}/${academicYear}/modules/${encodeURIComponent(
      normalizedCode,
    )}.json`,
  )

  moduleCache.set(cacheKey, module)
  return module
}
