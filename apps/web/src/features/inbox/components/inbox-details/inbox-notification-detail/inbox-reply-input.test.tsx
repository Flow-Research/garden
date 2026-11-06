import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InboxReplyInput } from './inbox-reply-input'

describe('InboxReplyInput model picker', () => {
  it('can be opened and changed from the keyboard', async () => {
    const user = userEvent.setup()
    render(<InboxReplyInput onSubmit={vi.fn(async () => true)} />)

    const trigger = screen.getByRole('button', { name: 'Model: Harnessy' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('menuitemradio', { name: 'Harnessy Pro' }),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(
      await screen.findByRole('button', {
        name: /^Model: Harnessy (Pro|Fast)$/,
      }),
    ).toBeInTheDocument()
  })
})
