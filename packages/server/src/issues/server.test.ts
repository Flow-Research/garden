import { describe, expect, it } from 'vitest'
import * as schema from '@garden/db/schema'
import { toIssue } from './server'

const date = new Date('2026-01-01T00:00:00.000Z')

function issueRecord(
  overrides: Partial<typeof schema.issue.$inferSelect> = {},
): typeof schema.issue.$inferSelect {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    workspaceId: '00000000-0000-0000-0000-000000000002',
    number: 42,
    title: 'Test issue',
    description: null,
    status: 'todo',
    priority: 'medium',
    assigneeType: null,
    assigneeId: null,
    position: 0,
    dueDate: null,
    activeRunId: null,
    sourceSummary: null,
    permissionsOverride: null,
    labels: [],
    parentId: null,
    projectId: null,
    createdBy: '00000000-0000-0000-0000-000000000003',
    createdAt: date,
    updatedAt: date,
    ...overrides,
  }
}

describe('toIssue', () => {
  it('formats identifiers with the workspace issue prefix', () => {
    expect(toIssue(issueRecord(), { issuePrefix: 'RDO' }).identifier).toBe('RDO-42')
  })
})
