import { describe, expect, it } from 'vitest'
import { schema } from '@/lib/server/db'
import { toAutomationRun } from './automations'

function automationRun(failureReason: string | null) {
  const row = {
    id: 'run-1',
    workspaceId: 'workspace-1',
    automationId: 'automation-1',
    triggerId: null,
    source: 'manual',
    status: 'failed',
    agentId: 'agent-1',
    hostName: 'test',
    workflowInstanceId: null,
    cancelRequestedAt: null,
    contextSnapshot: null,
    resultJson: null,
    usageJson: null,
    error: failureReason,
    startedAt: null,
    triggeredAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: null,
    failureReason,
    triggerPayload: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } satisfies typeof schema.automationRun.$inferSelect

  return toAutomationRun(row)
}

describe('toAutomationRun', () => {
  it('parses registered failure codes into public failures', () => {
    expect(automationRun('no_output').failure).toEqual({ cause: 'no_output' })
  })

  it('does not parse legacy text as a public failure', () => {
    const run = automationRun('legacy failure text')
    expect(run.failure).toBeNull()
    expect(run.failure_reason).toBe('legacy failure text')
  })
})
