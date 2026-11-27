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
    failure: null,
    blocked_reason: null,
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

  it('shows the typed failure title and next step', () => {
    render(
      panel({
        run: run({
          status: 'failed',
          failure: { cause: 'turn_timed_out' },
        }),
      }),
    )

    expect(
      screen.getByText(
        'The run took too long and was stopped. Try again, or split the task.',
      ),
    ).toBeTruthy()
  })

  it('shows the agent-authored reason for a blocked run', () => {
    render(
      panel({
        run: run({
          status: 'blocked',
          blocked_reason: 'The repository needs a deployment key.',
        }),
      }),
    )

    expect(
      screen.getByText('The repository needs a deployment key.'),
    ).toBeTruthy()
  })
})
