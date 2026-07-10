import { describe, expect, it } from 'vitest'
import { zodSchema } from 'ai'
import { assignIssueInputSchema } from './chat-assignment-schema'

const issue = 'ISS-43'
const agentId = '10000000-0000-4000-8000-000000000001'

describe('assignIssueInputSchema', () => {
  it('requires exactly one agent or member target', () => {
    expect(
      assignIssueInputSchema.safeParse({
        issue_id_or_identifier: issue,
        assignee_agent_id: agentId,
      }).success,
    ).toBe(true)
    expect(
      assignIssueInputSchema.safeParse({
        issue_id_or_identifier: issue,
        assignee_member: 'Julian',
      }).success,
    ).toBe(true)
    expect(
      assignIssueInputSchema.safeParse({ issue_id_or_identifier: issue })
        .success,
    ).toBe(false)
    expect(
      assignIssueInputSchema.safeParse({
        issue_id_or_identifier: issue,
        assignee_agent_id: agentId,
        assignee_member: 'Julian',
      }).success,
    ).toBe(false)
  })

  it('keeps both required alternatives in model-visible JSON Schema', () => {
    const jsonSchema = zodSchema(assignIssueInputSchema).jsonSchema as {
      anyOf?: Array<{ required?: string[] }>
    }
    const requiredAlternatives = jsonSchema.anyOf?.map((branch) =>
      [...(branch.required ?? [])].sort(),
    )

    expect(requiredAlternatives).toContainEqual([
      'assignee_agent_id',
      'issue_id_or_identifier',
    ])
    expect(requiredAlternatives).toContainEqual([
      'assignee_member',
      'issue_id_or_identifier',
    ])
  })
})
