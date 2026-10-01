import { describe, expect, it } from 'vitest'
import { zodSchema } from 'ai'
import { assignIssueInputSchema } from './chat-assignment-schema'

const issue = 'ISS-43'
const agentId = '10000000-0000-4000-8000-000000000001'

describe('assignIssueInputSchema', () => {
  it('requires a target and the matching assignee field', () => {
    expect(
      assignIssueInputSchema.safeParse({
        issue_id_or_identifier: issue,
        target: 'agent',
        assignee_agent_id: agentId,
      }).success,
    ).toBe(true)
    expect(
      assignIssueInputSchema.safeParse({
        issue_id_or_identifier: issue,
        target: 'member',
        assignee_member: 'Julian',
      }).success,
    ).toBe(true)
    expect(
      assignIssueInputSchema.safeParse({
        issue_id_or_identifier: issue,
        target: 'agent',
      }).success,
    ).toBe(false)
    expect(
      assignIssueInputSchema.safeParse({
        issue_id_or_identifier: issue,
        target: 'member',
      }).success,
    ).toBe(false)
    expect(
      assignIssueInputSchema.safeParse({ issue_id_or_identifier: issue })
        .success,
    ).toBe(false)
    expect(
      assignIssueInputSchema.safeParse({
        issue_id_or_identifier: issue,
        target: 'agent',
        assignee_agent_id: agentId,
        assignee_member: 'Julian',
      }).success,
    ).toBe(false)
  })

  it('emits a top-level object schema with a required target', () => {
    const jsonSchema = zodSchema(assignIssueInputSchema).jsonSchema as {
      type?: string
      required?: string[]
      properties?: Record<string, unknown>
    }

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.required ?? []).toContain('issue_id_or_identifier')
    expect(jsonSchema.required ?? []).toContain('target')
    expect(jsonSchema.required ?? []).not.toContain('assignee_agent_id')
    expect(jsonSchema.required ?? []).not.toContain('assignee_member')
  })
})
