import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProfilePage from '../../../src/features/profile/ProfilePage.tsx'
import {
  SignInRequired,
  getAccessToken,
  subscribeToSignOut,
  tryAutomaticSignIn,
} from '../../../src/features/forum/auth.ts'
import { loadLocalTopics } from '../../../src/features/profile/profileApi.ts'
import { fetchLectureSnapshot } from '../../../src/features/discovery/lectureApi.ts'
import type { LectureSnapshot } from '../../../src/features/discovery/types.ts'

vi.mock('../../../src/features/forum/auth.ts', async (original) => ({
  ...(await original<typeof import('../../../src/features/forum/auth.ts')>()),
  confirmSignedIn: vi.fn(),
  getAccessToken: vi.fn(),
  subscribeToSignOut: vi.fn(),
  tryAutomaticSignIn: vi.fn(),
}))
vi.mock('../../../src/features/discovery/lectureApi.ts', () => ({
  fetchLectureSnapshot: vi.fn(),
}))

const TOPICS = ['Physics', 'Chemistry', 'History', 'Economics']
let fetchMock: ReturnType<typeof vi.fn>

// Bodies of the PUT /profile/topics requests, in order.
const savedOrders = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)).topics)

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(tryAutomaticSignIn).mockResolvedValue(false)
  vi.mocked(getAccessToken).mockResolvedValue('test-token')
  vi.mocked(subscribeToSignOut).mockReturnValue(vi.fn())
  vi.mocked(fetchLectureSnapshot).mockResolvedValue({
    index: { topics: TOPICS },
    modules: [],
  } as unknown as LectureSnapshot)
  fetchMock = vi.fn().mockImplementation(async (_url, init?: RequestInit) => {
    const topics =
      init?.method === 'PUT'
        ? JSON.parse(String(init.body)).topics
        : ['Physics', 'History']
    return new Response(JSON.stringify({ username: 'CuriousKaki', topics }))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderOrder() {
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Your topics' })
  return screen.getByRole('list', { name: 'Your topics' })
}

const order = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.topic-name')?.textContent)

it('lists saved topics in order, adding new picks at the end', async () => {
  const list = await renderOrder()
  expect(order(list)).toEqual(['Physics', 'History'])

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Economics' }))
  })
  expect(order(list)).toEqual(['Physics', 'History', 'Economics'])
  expect(savedOrders().at(-1)).toEqual(['Physics', 'History', 'Economics'])
})

it('moves and removes topics, saving the new order', async () => {
  const list = await renderOrder()

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Move History up' }))
  })
  expect(order(list)).toEqual(['History', 'Physics'])
  expect(savedOrders().at(-1)).toEqual(['History', 'Physics'])
  expect(
    (
      screen.getByRole('button', {
        name: 'Move History up',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true)

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Remove History' }))
  })
  expect(order(list)).toEqual(['Physics'])
  expect(savedOrders().at(-1)).toEqual(['Physics'])
})

it('saves topics in this browser when signed out', async () => {
  vi.mocked(getAccessToken).mockRejectedValue(new SignInRequired())
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  )
  expect(
    await screen.findByRole('heading', { name: 'Log in or sign up' }),
  ).toBeTruthy()

  fireEvent.click(await screen.findByRole('button', { name: 'History' }))
  fireEvent.click(screen.getByRole('button', { name: 'Physics' }))
  fireEvent.click(screen.getByRole('button', { name: 'Move Physics up' }))

  expect(loadLocalTopics()).toEqual(['Physics', 'History'])
  expect(savedOrders()).toEqual([])

  // Coming back later shows the same picks.
  cleanup()
  const list = await renderOrder()
  expect(order(list)).toEqual(['Physics', 'History'])
})

it('copies browser topics to an account that has none on sign-in', async () => {
  localStorage.setItem(
    'lecturekaki:topics:v1',
    JSON.stringify(['Economics', 'Chemistry']),
  )
  fetchMock.mockImplementation(async (_url, init?: RequestInit) => {
    const topics =
      init?.method === 'PUT' ? JSON.parse(String(init.body)).topics : []
    return new Response(JSON.stringify({ username: 'CuriousKaki', topics }))
  })

  const list = await renderOrder()
  expect(order(list)).toEqual(['Economics', 'Chemistry'])
  await act(() => Promise.resolve())
  expect(savedOrders()).toEqual([['Economics', 'Chemistry']])
})
