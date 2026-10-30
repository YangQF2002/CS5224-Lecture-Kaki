import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { SignInRequired } from '../../../src/features/forum/auth.ts'
import { roomId } from './fixtures.ts'
import { api, emit, own, renderForum } from './setup.tsx'

it('shows history and live replies, with deletion controls only on owned messages', async () => {
  renderForum()
  await screen.findByText('Hello lecture')
  emit({
    type: 'message.created',
    room_id: roomId,
    message: {
      ...own,
      message_id: '2-b',
      author_id: 'student-b',
      content: 'Live reply',
    },
  })
  expect(screen.getByText('Live reply')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
})
it('posts a message once and merges its matching live event', async () => {
  const message = { ...own, message_id: '2-a', content: 'New question' }
  api.post.mockResolvedValueOnce(message)
  renderForum()
  fireEvent.change(await screen.findByLabelText('Your message'), {
    target: { value: message.content },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText(message.content)
  emit({ type: 'message.created', room_id: roomId, message })
  expect(screen.getAllByText(message.content)).toHaveLength(1)
  expect(api.post).toHaveBeenCalledOnce()
  expect(
    (screen.getByLabelText('Your message') as HTMLTextAreaElement).value,
  ).toBe('')
})
it('deletes an owned message', async () => {
  renderForum()
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByText('Hello lecture')).toBeNull())
  expect(api.delete).toHaveBeenCalledOnce()
})
it('requires sign-in before showing protected discussion content', async () => {
  api.user.mockRejectedValueOnce(new SignInRequired())
  renderForum()
  expect(
    await screen.findByRole('button', { name: 'Sign in with NUS email' }),
  ).toBeTruthy()
  expect(screen.queryByLabelText('Your message')).toBeNull()
})
it('keeps the draft if posting fails', async () => {
  api.post.mockRejectedValueOnce(new Error('offline'))
  renderForum()
  fireEvent.change(await screen.findByLabelText('Your message'), {
    target: { value: 'Keep my question' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByRole('alert')
  expect(
    (screen.getByLabelText('Your message') as HTMLTextAreaElement).value,
  ).toBe('Keep my question')
})
it('clears protected content when another tab signs out', async () => {
  renderForum()
  await screen.findByText('Hello lecture')
  act(() => {
    localStorage.setItem('lecturekaki:sign-out:v1', 'signed-out')
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'lecturekaki:sign-out:v1' }),
    )
  })
  expect(screen.queryByText('Hello lecture')).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Sign in with NUS email' }),
  ).toBeTruthy()
})
it('rejects an unpublished room before accessing the Forum API', async () => {
  renderForum(`/forum/${encodeURIComponent(roomId.replace('-01@', '-99@'))}`)
  expect(
    await screen.findByRole('heading', { name: 'Discussion unavailable' }),
  ).toBeTruthy()
  expect(api.user).not.toHaveBeenCalled()
})
