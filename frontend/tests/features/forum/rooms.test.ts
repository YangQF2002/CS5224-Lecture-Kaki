import { beforeEach, expect, it, vi } from 'vitest'
import {
  fetchLectureSnapshot,
  fetchWeekSessions,
} from '../../../src/features/discovery/lectureApi.ts'
import {
  resolveRoom,
  roomFromLink,
  roomIdFor,
  roomPath,
} from '../../../src/features/forum/roomCatalogue.ts'
import { lecture, roomId, snapshot, weekData } from './fixtures.ts'

vi.mock('../../../src/features/discovery/lectureApi.ts', () => ({
  fetchLectureSnapshot: vi.fn(),
  fetchWeekSessions: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchLectureSnapshot).mockResolvedValue(snapshot)
  vi.mocked(fetchWeekSessions).mockResolvedValue(weekData('week-10'))
})
it.each(['LT11', 'CQT/SR0514'])(
  'preserves published IDs and shared links for %s',
  async (venue) => {
    const session = { ...lecture, id: lecture.id.replace('LT11', venue), venue }
    vi.mocked(fetchWeekSessions).mockResolvedValue({
      ...weekData('week-10'),
      sessions: [session],
    })
    const id = roomIdFor(session, snapshot.pointer)
    expect(id).toContain('-LEC-01@')
    expect(roomFromLink(`https://website.example${roomPath(id)}`)).toBe(id)
    expect((await resolveRoom(id)).session).toEqual(session)
    expect(roomFromLink('javascript:alert(1)')).toBeNull()
  },
)
it('rejects an unpublished lecture', async () => {
  await expect(resolveRoom(roomId.replace('-01@', '-99@'))).rejects.toThrow(
    'not in the current lecture list',
  )
})
it('rejects a room from another term', async () => {
  await expect(
    resolveRoom(roomId.replace('@2026-2027@1', '@2025-2026@1')),
  ).rejects.toThrow('different term')
})
