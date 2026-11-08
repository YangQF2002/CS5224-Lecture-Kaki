import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SidebarTopics from '../../../src/features/profile/SidebarTopics.tsx'
import {
  SignInRequired,
  getAccessToken,
  subscribeToSignOut,
} from '../../../src/features/forum/auth.ts'
import {
  saveLocalTopics,
  saveTopics,
} from '../../../src/features/profile/profileApi.ts'

vi.mock('../../../src/features/forum/auth.ts', async (original) => ({
  ...(await original<typeof import('../../../src/features/forum/auth.ts')>()),
  getAccessToken: vi.fn(),
  subscribeToSignOut: vi.fn(),
}))

let notifySignOut: () => void
const profile = (topics: string[]) =>
  new Response(JSON.stringify({ username: 'CuriousKaki', topics }))

function renderTopics() {
  render(
    <MemoryRouter>
      <SidebarTopics />
    </MemoryRouter>,
  )
}

const links = () => screen.getAllByRole('link').map((link) => link.textContent)

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(getAccessToken).mockResolvedValue('test-token')
  vi.mocked(subscribeToSignOut).mockImplementation((listener) => {
    notifySignOut = listener
    return vi.fn()
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows suggestions when signed out', async () => {
  vi.mocked(getAccessToken).mockRejectedValue(new SignInRequired())
  renderTopics()

  expect(await screen.findByText('Choose your interests')).toBeTruthy()
  expect(links()).toEqual([
    'AI & Machine Learning',
    'Psychology',
    'Arts & Media',
    'Choose your interests',
  ])
})

it("shows the user's saved topics, up to five", async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        profile([
          'Data Science',
          'Cybersecurity',
          'Mathematics',
          'Statistics & Probability',
          'Psychology',
          'History',
          'Economics',
        ]),
      ),
  )
  renderTopics()

  expect(await screen.findByText('Edit interests (2 more)')).toBeTruthy()
  expect(links().slice(0, 5)).toEqual([
    'Data Science',
    'Cybersecurity',
    'Mathematics',
    'Statistics & Probability',
    'Psychology',
  ])
  expect(
    screen.getByRole('link', { name: 'Data Science' }).getAttribute('href'),
  ).toBe('/?topics=Data+Science')
})

it('updates when topics are saved, and resets on sign-out', async () => {
  const fetch = vi.fn().mockResolvedValue(profile(['Physics']))
  vi.stubGlobal('fetch', fetch)
  renderTopics()
  expect(await screen.findByText('Edit your interests')).toBeTruthy()

  fetch.mockResolvedValue(profile(['Physics', 'Chemistry']))
  await act(() => saveTopics(['Physics', 'Chemistry'], getAccessToken))
  expect(links()).toEqual(['Physics', 'Chemistry', 'Edit your interests'])

  act(() => notifySignOut())
  expect(screen.getByText('Choose your interests')).toBeTruthy()
})

it("shows this browser's topics when signed out, and follows changes", async () => {
  vi.mocked(getAccessToken).mockRejectedValue(new SignInRequired())
  saveLocalTopics(['History'])
  renderTopics()

  expect(await screen.findByText('Edit your interests')).toBeTruthy()
  expect(links()).toEqual(['History', 'Edit your interests'])

  act(() => saveLocalTopics(['Economics', 'History']))
  expect(links()).toEqual(['Economics', 'History', 'Edit your interests'])
})
