import type {
    ModuleSummary,
    NusmodsModule,
} from './types.ts'

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
    const calenderYear = date.getFullYear()
    const academicYearStart =
        date.getMonth() >= 7 ? calenderYear : calenderYear - 1 // start of academic year is August, which is month 7 (0-indexed)

    return `${academicYearStart}/${academicYearStart + 1}`
}

export function getDefaultSemester(date = new Date()): 1 | 2 {
    return date.getMonth() >= 7 ? 1 : 2 // 1st sem starts in August, 2nd sem starts in January
}

export function fetchModuleList(academicYear: string): Promise<ModuleSummary[]> {
    return fetchJson<ModuleSummary[]>(
        `${API_BASE_URL}/${academicYear}/moduleList.json`
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
