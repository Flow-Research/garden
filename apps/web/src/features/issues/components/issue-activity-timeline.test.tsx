import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TimelineEntry } from '@garden/core/types'
import { IssueActivityTimeline } from './issue-activity-timeline'

describe('IssueActivityTimeline run failures', () => {
  it('shows safe failure copy for a legacy raw-error payload', () => {
    const raw = 'internal provider detail with secret abc123'
    const entry = {
      type: 'activity',
      id: 'event-1',
      actor_type: 'agent',
      actor_id: 'agent-1',
      action: 'issue_run:failed',
      details: { reason: raw, error: raw },
      created_at: new Date().toISOString(),
      event: {
        id: 'event-1',
        workspace_id: 'workspace-1',
        issue_id: 'issue-1',
        run_id: 'run-1',
        seq: 1,
        event_type: 'issue_run:failed',
        stream: 'system',
        level: 'error',
        message: 'Run failed',
        payload: { reason: raw, error: raw },
        created_at: new Date().toISOString(),
      },
    } satisfies TimelineEntry

    render(
      <IssueActivityTimeline
        timeline={[entry]}
        debugMode={false}
        highlightedId={null}
        issueId="issue-1"
        currentUserId="user-1"
        getActorName={() => 'Agent'}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleReaction={vi.fn()}
      />,
    )

    expect(
      screen.getByText(
        /agent run stopped: The run stopped for an unexpected reason\./i,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Try again\. If it keeps happening, tell your workspace admin\./i,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(raw)).not.toBeInTheDocument()
  })
})
