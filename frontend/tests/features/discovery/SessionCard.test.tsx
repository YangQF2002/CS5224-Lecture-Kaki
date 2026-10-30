import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import SessionCard from '../../../src/features/discovery/SessionCard.tsx'
import type { LectureSession } from '../../../src/features/discovery/types.ts'

afterEach(cleanup)
it('links a lecture occurrence to its term-specific Forum without changing its ID', () => {
  const session: LectureSession = {
    id: 'BT1101-LEC-01@2026-10-20-0800-LT11',
    moduleCode: 'BT1101',
    moduleTitle: 'Business Analytics',
    crossListed: [],
    faculty: 'Computing',
    department: 'Computing',
    level: 1000,
    lessonType: 'Lecture',
    classNo: '01',
    date: '2026-10-20',
    startTime: '0800',
    endTime: '1000',
    venue: 'LT11',
    building: null,
    online: false,
    size: 100,
  }
  render(
    <MemoryRouter>
      <SessionCard
        session={session}
        module={undefined}
        acadYear="2026-2027"
        semester={1}
      />
    </MemoryRouter>,
  )
  expect(
    screen.getByRole('link', { name: 'Join discussion' }).getAttribute('href'),
  ).toBe(`/forum/${encodeURIComponent(`${session.id}@2026-2027@1`)}`)
})
