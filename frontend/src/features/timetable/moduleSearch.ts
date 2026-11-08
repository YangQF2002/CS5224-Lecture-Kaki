import type { ModuleSummary } from './types.ts'

// Lower numbers rank first.
const EXACT_CODE = 0
const CODE_PREFIX = 1
const TITLE_PREFIX = 2
const WORD_PREFIXES = 3
const CONTAINS = 4

function rank(module: ModuleSummary, query: string, words: string[]) {
  const code = module.moduleCode.toLowerCase()
  const title = module.title.toLowerCase()
  const text = `${code} ${title}`
  if (!words.every((word) => text.includes(word))) return null

  const compact = query.replace(/\s+/g, '')
  if (code === compact) return EXACT_CODE
  if (code.startsWith(compact)) return CODE_PREFIX
  if (title.startsWith(query)) return TITLE_PREFIX
  const starts = [code, ...title.split(/[^a-z0-9]+/)]
  if (words.every((word) => starts.some((start) => start.startsWith(word))))
    return WORD_PREFIXES
  return CONTAINS
}

// Modules offered in `semester` matching every word of `query`, best first.
export function searchModules(
  modules: ModuleSummary[],
  query: string,
  semester: number,
): ModuleSummary[] {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalized) return []
  const words = normalized.split(' ')

  return modules
    .filter((module) => module.semesters.includes(semester))
    .flatMap((module) => {
      const score = rank(module, normalized, words)
      return score === null ? [] : [{ module, score }]
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.module.moduleCode.localeCompare(b.module.moduleCode),
    )
    .map(({ module }) => module)
}
