import { describe, expect, it } from 'vitest'
import type { AgentPermissions } from '@garden/core/agents/permissions'
import { isChatToolAllowed } from './chat-permissions'

const FULL_ACCESS: AgentPermissions = {
  full_access: true,
  allowed_skills: [],
  allowed_connectors: [],
  allowed_tools: [],
  approval_overrides: {},
}

const RESTRICTED: AgentPermissions = {
  full_access: false,
  allowed_skills: [],
  allowed_connectors: ['github'],
  allowed_tools: ['add_issue_comment'],
  approval_overrides: {},
}

describe('chat tool gate', () => {
  it('allows everything when unrestricted', () => {
    expect(isChatToolAllowed(null, 'tool_github_add_issue_comment')).toBe(true)
    expect(isChatToolAllowed(null, 'create_issue')).toBe(true)
    expect(isChatToolAllowed(FULL_ACCESS, 'tool_slack_post_message')).toBe(
      true,
    )
  })

  it('allows listed tools by bare and runtime names', () => {
    expect(
      isChatToolAllowed(RESTRICTED, 'tool_github_add_issue_comment'),
    ).toBe(true)
    expect(isChatToolAllowed(RESTRICTED, 'create_issue')).toBe(false)
  })

  it('blocks connectors outside the list', () => {
    expect(isChatToolAllowed(RESTRICTED, 'tool_slack_post_message')).toBe(
      false,
    )
  })

  it('allows non-connector tools not on a non-empty list only when listed', () => {
    expect(isChatToolAllowed(RESTRICTED, 'read_issue')).toBe(false)
    expect(
      isChatToolAllowed(
        { ...RESTRICTED, allowed_tools: ['read_issue'] },
        'read_issue',
      ),
    ).toBe(true)
  })
})
