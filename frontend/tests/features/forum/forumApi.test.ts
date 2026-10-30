import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})
it('uses secure WebSockets on the configured HTTPS API origin and preserves its prefix', async () => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test/api/')
  vi.resetModules()
  const { forumSocketUrl } =
    await import('../../../src/features/forum/forumApi.ts')
  expect(forumSocketUrl('/rooms/room%40term/live?ticket=one')).toBe(
    'wss://api.example.test/api/rooms/room%40term/live?ticket=one',
  )
})
it('uses local WebSockets for an HTTP development API', async () => {
  vi.stubEnv('VITE_API_URL', 'http://localhost:8000')
  vi.resetModules()
  const { forumSocketUrl } =
    await import('../../../src/features/forum/forumApi.ts')
  expect(forumSocketUrl('/rooms/room/live?ticket=one')).toBe(
    'ws://localhost:8000/rooms/room/live?ticket=one',
  )
})
