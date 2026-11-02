import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActiveRunPanel, type ActiveRunPanelProps } from './active-run-panel'

vi.mock('@/features/common/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}))

type Run = ActiveRunPanelProps['run']

function run(overrides: Partial<Run>): Run {
  return {
    id: 'run-1',
    status: 'running',
    started_at: null,
    finished_at: null,
    error: null,
    usage: null,
    ...overrides,
  } as Run
}

const APPROVAL = {
  title: 'Garden wants to comment on acme/web#142',
  body: 'Looks good to me.',
}

function panel(props: Partial<ActiveRunPanelProps>) {
  return (
    <ActiveRunPanel
      agent={{ name: 'Garden' }}
      run={run({})}
      pendingApprovalPreview={APPROVAL}
      onApprove={vi.fn()}
      onDeny={vi.fn()}
      {...props}
    />
  )
}

describe('ActiveRunPanel', () => {
  it('opens the approval card when a running run starts waiting for approval', () => {
    const { rerender } = render(panel({ run: run({ status: 'running' }) }))
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull()

    rerender(panel({ run: run({ status: 'waiting_for_approval' }) }))

    expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy()
  })

  it('disables approve and deny while the decision is being sent', () => {
    render(
      panel({
        run: run({ status: 'waiting_for_approval' }),
        approvalPending: true,
      }),
    )

    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /deny/i })).toBeDisabled()
  })

  it('does not offer an edit action without a handler', () => {
    render(panel({ run: run({ status: 'waiting_for_approval' }) }))

    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
  })
})
