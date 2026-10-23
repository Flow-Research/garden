import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { InboxItem } from '@garden/core/types'
import { InboxListItemV2 } from './inbox-list-item-v2'

vi.mock('@/lib/workspace/hooks', () => ({
  useActorName: () => ({ getActorName: () => 'Ada' }),
}))

const ITEM = {
  id: 'item-1',
  title: 'Review the release notes',
  read: false,
  created_at: '2026-10-20T10:00:00.000Z',
  details: null,
} as unknown as InboxItem

describe('InboxListItemV2', () => {
  it('archives once when Archive is pressed with Enter, without opening the item', async () => {
    const onClick = vi.fn()
    const onArchive = vi.fn()
    render(
      <InboxListItemV2
        item={ITEM}
        eventCount={1}
        isSelected={false}
        onClick={onClick}
        onArchive={onArchive}
      />,
    )

    screen
      .getByRole('button', {
        name: 'Archive thread for Review the release notes',
      })
      .focus()
    await userEvent.keyboard('{Enter}')

    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('opens the item from the row', async () => {
    const onClick = vi.fn()
    render(
      <InboxListItemV2
        item={ITEM}
        eventCount={1}
        isSelected={false}
        onClick={onClick}
        onArchive={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByText('Review the release notes'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
