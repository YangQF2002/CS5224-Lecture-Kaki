import { fireEvent, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { lecture, laterLecture } from './fixtures.ts'
import { renderForum } from './setup.tsx'

it('opens an actual lecture from the picker without typing a room ID', async () => {
  renderForum('/forum?browse=1&week=week-10')
  await screen.findByText(lecture.moduleTitle)
  fireEvent.click(screen.getByRole('link', { name: /Join BT1101 discussion/ }))
  expect(
    await screen.findByRole('heading', { name: 'BT1101 discussion' }),
  ).toBeTruthy()
})
it('returns to the selected room and draft after visiting Timetable', async () => {
  renderForum()
  fireEvent.change(await screen.findByLabelText('Your message'), {
    target: { value: 'My unsent question' },
  })
  fireEvent.click(screen.getByRole('link', { name: 'My timetable' }))
  await screen.findByRole('heading', { name: 'My timetable' })
  fireEvent.click(screen.getByRole('link', { name: 'Forum' }))
  expect(
    ((await screen.findByLabelText('Your message')) as HTMLTextAreaElement)
      .value,
  ).toBe('My unsent question')
})
it('returns to the picker with its filters when that was the last Forum screen', async () => {
  renderForum()
  fireEvent.click(
    await screen.findByRole('link', { name: 'Choose another lecture' }),
  )
  await screen.findByRole('option', { name: /Week 11/ })
  fireEvent.change(screen.getByLabelText('Week'), {
    target: { value: 'week-11' },
  })
  fireEvent.change(screen.getByLabelText('Find a lecture'), {
    target: { value: 'CS5224' },
  })
  await screen.findByText(laterLecture.moduleTitle)
  fireEvent.click(screen.getByRole('link', { name: 'My timetable' }))
  await screen.findByRole('heading', { name: 'My timetable' })
  fireEvent.click(screen.getByRole('link', { name: 'Forum' }))
  await screen.findByRole('heading', { name: 'Lecture Forum' })
  expect((screen.getByLabelText('Week') as HTMLSelectElement).value).toBe(
    'week-11',
  )
  expect(
    (screen.getByLabelText('Find a lecture') as HTMLInputElement).value,
  ).toBe('CS5224')
  expect(screen.queryByLabelText('Your message')).toBeNull()
})
