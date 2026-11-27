import { describe, expect, it, vi } from 'vitest'
import { getRunWorkflowTurnCompleteEventType } from './run-workflow'

vi.mock('agents/workflows', () => ({
  AgentWorkflow: class {},
}))

/**
 * Cloudflare Workflows rejects event types outside this pattern or over 100
 * characters (developers.cloudflare.com/workflows/build/events-and-parameters,
 * footnote 1). Local miniflare does not enforce it, so production sendEvent
 * failed while dev tests passed.
 */
const WORKFLOW_EVENT_TYPE = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/

describe('getRunWorkflowTurnCompleteEventType', () => {
  it.each([
    'issue-run:b749d28b-e4db-4375-8c93-9653038721bf:0:start',
    'automation-run:b749d28b-e4db-4375-8c93-9653038721bf:12:resume',
  ])('builds a Workflows-valid event type for %s', (submissionId) => {
    const type = getRunWorkflowTurnCompleteEventType(submissionId)
    expect(type).toMatch(WORKFLOW_EVENT_TYPE)
    expect(type.length).toBeLessThanOrEqual(100)
  })

  it('keeps distinct submissions on distinct event types', () => {
    expect(getRunWorkflowTurnCompleteEventType('issue-run:a:0:start')).not.toBe(
      getRunWorkflowTurnCompleteEventType('issue-run:a:0:resume'),
    )
  })
})
