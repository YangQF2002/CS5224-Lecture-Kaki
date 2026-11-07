import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AccountMenu from '../../../src/features/profile/AccountMenu.tsx'
import { saveUsername } from '../../../src/features/profile/profileApi.ts'
import {
  SignInRequired,
  getAccessToken,
  signOut,
  startPasswordChange,
  startSignIn,
  subscribeToSignOut,
} from '../../../src/features/forum/auth.ts'

vi.mock('../../../src/features/forum/auth.ts', async (original) => ({
  ...(await original<typeof import('../../../src/features/forum/auth.ts')>()),
  getAccessToken: vi.fn(),
  signOut: vi.fn(),
  startPasswordChange: vi.fn(),
  startSignIn: vi.fn(),
  subscribeToSignOut: vi.fn(),
}))

let notifySignOut: () => void
const profileResponse = (username = 'CuriousKaki') =>
  new Response(JSON.stringify({ username, topics: [] }))

function renderMenu(url = '/') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <AccountMenu />
      <button>Outside</button>
      <Routes>
        <Route path="/profile" element={<h1>Your profile</h1>} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getAccessToken).mockResolvedValue('test-token')
  vi.mocked(signOut).mockResolvedValue(undefined)
  vi.mocked(startPasswordChange).mockResolvedValue(undefined)
  vi.mocked(startSignIn).mockResolvedValue(undefined)
  vi.mocked(subscribeToSignOut).mockImplementation((listener) => {
    notifySignOut = listener
    return vi.fn()
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => profileResponse()),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows the real username and opens the profile from account options', async () => {
  renderMenu()
  const trigger = await screen.findByRole('button', {
    name: 'Account options for CuriousKaki',
  })
  expect(screen.queryByRole('group', { name: 'Account options' })).toBeNull()
  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('link', { name: 'View profile' }))
  expect(screen.getByRole('heading', { name: 'Your profile' })).toBeTruthy()
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it('dismisses the options on Escape, outside click, and focus leaving the menu', async () => {
  renderMenu()
  const trigger = await screen.findByRole('button', {
    name: /Account options for CuriousKaki/,
  })
  fireEvent.click(trigger)
  const profileLink = screen.getByRole('link', { name: 'View profile' })
  profileLink.focus()
  fireEvent.keyDown(profileLink, { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  fireEvent.pointerDown(screen.getByText('Outside'))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  fireEvent.blur(trigger, { relatedTarget: screen.getByText('Outside') })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it('uses the existing sign-out flow and reflects session removal', async () => {
  renderMenu()
  fireEvent.click(
    await screen.findByRole('button', {
      name: /Account options for CuriousKaki/,
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
  act(() => notifySignOut())
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  expect(screen.queryByText('CuriousKaki')).toBeNull()
})

it('starts a password change with the current page as the return destination', async () => {
  renderMenu('/?topics=Psychology#main-content')
  fireEvent.click(
    await screen.findByRole('button', {
      name: /Account options for CuriousKaki/,
    }),
  )
  expect(startPasswordChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
  await waitFor(() =>
    expect(startPasswordChange).toHaveBeenCalledWith(
      '/?topics=Psychology#main-content',
    ),
  )
  expect(signOut).not.toHaveBeenCalled()
})

it('disables account actions while opening password recovery and allows retry on failure', async () => {
  let fail!: (reason: Error) => void
  vi.mocked(startPasswordChange).mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject
    }),
  )
  renderMenu()
  const trigger = await screen.findByRole<HTMLButtonElement>('button', {
    name: /Account options for CuriousKaki/,
  })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
  expect(trigger.disabled).toBe(true)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Opening…' })
      .disabled,
  ).toBe(true)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Sign out' })
      .disabled,
  ).toBe(true)
  await act(async () => fail(new Error('Unable to open password recovery.')))
  expect(screen.getByRole('alert').textContent).toBe(
    'Unable to open password recovery.',
  )
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Change password' })
      .disabled,
  ).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
  await waitFor(() => expect(startPasswordChange).toHaveBeenCalledTimes(2))
})

it('offers sign-in without automatically redirecting and returns to the current page', async () => {
  vi.mocked(getAccessToken).mockRejectedValue(new SignInRequired())
  renderMenu('/?topics=Psychology#main-content')
  const signIn = await screen.findByRole('button', { name: 'Sign in' })
  expect(startSignIn).not.toHaveBeenCalled()
  fireEvent.click(signIn)
  await waitFor(() =>
    expect(startSignIn).toHaveBeenCalledWith(
      '/?topics=Psychology#main-content',
    ),
  )
})

it('shows sign-in failures without leaving an unhandled rejection', async () => {
  vi.mocked(getAccessToken).mockRejectedValue(new SignInRequired())
  vi.mocked(startSignIn).mockRejectedValue(
    new Error('Sign-in service is unavailable.'),
  )
  renderMenu()
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Sign-in service is unavailable.',
  )
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Sign in' }).disabled,
  ).toBe(false)
})

it('updates the name when a username save succeeds', async () => {
  renderMenu()
  await screen.findByRole('button', { name: /Account options for CuriousKaki/ })
  vi.mocked(fetch).mockResolvedValueOnce(profileResponse('NewKaki'))
  await act(async () => {
    await saveUsername('NewKaki', getAccessToken)
  })
  expect(
    screen.getByRole('button', { name: 'Account options for NewKaki' }),
  ).toBeTruthy()
})

it('does not restore the old identity when a profile load finishes after sign-out', async () => {
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  renderMenu()
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  act(() => notifySignOut())
  await act(async () => {
    finish(profileResponse())
  })
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  expect(screen.queryByText('CuriousKaki')).toBeNull()
})

it('keeps account access available when the profile API fails', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 503 }))
  renderMenu()
  const trigger = screen.getByRole<HTMLButtonElement>('button', {
    name: 'Account options for Account',
  })
  await waitFor(() => expect(trigger.disabled).toBe(false))
  fireEvent.click(trigger)
  expect(screen.getByText('Your profile couldn’t be loaded.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'View profile' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
})
