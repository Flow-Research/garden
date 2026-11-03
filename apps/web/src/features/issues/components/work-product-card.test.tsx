import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkProductCard, type WorkProductCardProps } from './work-product-card'

vi.mock('@/features/common/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}))

function workProduct(
  overrides: Partial<WorkProductCardProps['workProduct']>,
): WorkProductCardProps['workProduct'] {
  return {
    id: 'wp-1',
    type: 'connector_reply',
    status: 'approved',
    review_state: 'approved',
    is_primary: true,
    title: 'Reply to the bug report',
    body: 'Thanks, fixed in the next release.',
    applied_external_url: null,
    previous_versions_count: 0,
    updated_at: '2026-10-20T10:00:00.000Z',
    ...overrides,
  }
}

describe('WorkProductCard', () => {
  it('asks before posting to the connector and posts once', async () => {
    let finish: () => void = () => {}
    const onApply = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    )
    render(
      <WorkProductCard
        workProduct={workProduct({})}
        connectorId="github"
        onApply={onApply}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /apply to github/i }))
    expect(onApply).not.toHaveBeenCalled()

    const post = await screen.findByRole('button', { name: 'Post' })
    fireEvent.click(post)
    fireEvent.click(await screen.findByRole('button', { name: 'Posting…' }))
    finish()

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Posting…' })).toBeNull(),
    )
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('disables review actions while a review is in flight', () => {
    render(
      <WorkProductCard
        workProduct={workProduct({ status: 'review', review_state: 'pending' })}
        pendingAction="approve"
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /approving/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /request changes/i }),
    ).toBeDisabled()
  })
})
