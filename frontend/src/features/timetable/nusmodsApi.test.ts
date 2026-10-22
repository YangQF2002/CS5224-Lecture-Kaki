import { expect, it } from 'vitest'
import { getCurrentAcademicYear } from './nusmodsApi.ts'

it.each([
  [new Date(2026, 6, 31), '2025-2026'],
  [new Date(2026, 7, 1), '2026-2027'],
])(
  'uses an API-compatible academic year at the August boundary',
  (date, year) => {
    expect(getCurrentAcademicYear(date)).toBe(year)
  },
)
