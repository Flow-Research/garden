import { describe, expect, it } from 'vitest'
import type { AgentPermissions } from '@garden/core/agents/permissions'
import {
  evaluateExecutorCallTeamPolicy,
  isChatToolAllowed,
  isTeamToolAllowed,
} from './chat-permissions'
import {
  DEFAULT_TEAM_AGENT_POLICY,
  NO_TEAM_AGENT_POLICY,
  combineTeamAgentPolicies,
  type TeamAgentPolicy,
} from '@garden/core/teams/agent-policy'
import { EXECUTOR_TOOL_KEY_PREFIX } from './runtime-mcp-controller'

const allowed = (permissions: AgentPermissions | null, toolName: string) =>
  isChatToolAllowed(permissions, NO_TEAM_AGENT_POLICY, toolName)

const teamPolicy = (overrides: Partial<TeamAgentPolicy>) =>
  combineTeamAgentPolicies([
    {
      teamId: 'team-1',
      teamName: 'Finance',
      policy: { ...DEFAULT_TEAM_AGENT_POLICY, ...overrides },
    },
  ])

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
    expect(allowed(null, 'tool_github_add_issue_comment')).toBe(true)
    expect(allowed(null, 'create_issue')).toBe(true)
    expect(allowed(FULL_ACCESS, 'tool_slack_post_message')).toBe(true)
  })

  it('allows listed tools by bare and runtime names', () => {
    expect(allowed(RESTRICTED, 'tool_github_add_issue_comment')).toBe(true)
    expect(allowed(RESTRICTED, 'create_issue')).toBe(false)
  })

  it('blocks connectors outside the list', () => {
    expect(allowed(RESTRICTED, 'tool_slack_post_message')).toBe(false)
  })

  it('treats empty tool and connector lists as no limit', () => {
    const skillsOnly: AgentPermissions = {
      ...RESTRICTED,
      allowed_skills: ['research'],
      allowed_tools: [],
      allowed_connectors: [],
    }
    expect(allowed(skillsOnly, 'create_issue')).toBe(true)
    expect(allowed(skillsOnly, 'tool_slack_post_message')).toBe(true)
  })

  it('allows non-connector tools not on a non-empty list only when listed', () => {
    expect(allowed(RESTRICTED, 'read_issue')).toBe(false)
    expect(
      allowed({ ...RESTRICTED, allowed_tools: ['read_issue'] }, 'read_issue'),
    ).toBe(true)
  })
})

describe('Team policy tool gate', () => {
  const slackRead =
    'await tools.slack.org.main.slack_read_channel({ channel: "C1" })'

  it('removes a blocked area from the tool list', () => {
    const policy = teamPolicy({ allowed_areas: ['tasks', 'connections'] })
    expect(isChatToolAllowed(null, policy, 'brain_search')).toBe(false)
    expect(isChatToolAllowed(null, policy, 'activate_skill')).toBe(false)
    expect(isChatToolAllowed(null, policy, 'create_issue')).toBe(true)
  })

  it('keeps untagged tools available under any policy', () => {
    const policy = teamPolicy({ allowed_areas: [] })
    expect(isChatToolAllowed(null, policy, 'web_search')).toBe(true)
    expect(isChatToolAllowed(null, policy, 'post_comment')).toBe(true)
  })

  it('removes a blocked connector, and every connector tool with Connections off', () => {
    const blockedSlack = teamPolicy({ blocked_connector_ids: ['slack'] })
    expect(
      isChatToolAllowed(null, blockedSlack, 'tool_slack_slack_read_channel'),
    ).toBe(false)
    expect(
      isChatToolAllowed(null, blockedSlack, 'tool_github_add_issue_comment'),
    ).toBe(true)

    const noConnections = teamPolicy({ allowed_areas: ['tasks'] })
    expect(
      isChatToolAllowed(null, noConnections, 'tool_github_add_issue_comment'),
    ).toBe(false)
    expect(
      isTeamToolAllowed(noConnections, `${EXECUTOR_TOOL_KEY_PREFIX}execute`),
    ).toBe(false)
  })

  it('removes connector tools of a blocked risk class', () => {
    const policy = teamPolicy({ blocked_risk_classes: ['send_external'] })
    expect(
      isChatToolAllowed(null, policy, 'tool_slack_slack_create_canvas'),
    ).toBe(false)
    expect(
      isChatToolAllowed(null, policy, 'tool_slack_slack_read_channel'),
    ).toBe(true)
  })

  it('never grants a tool the agent lacks', () => {
    expect(isChatToolAllowed(RESTRICTED, teamPolicy({}), 'create_issue')).toBe(
      false,
    )
  })

  it('checks connectors named inside an Executor call', () => {
    const policy = teamPolicy({ blocked_connector_ids: ['slack'] })
    expect(
      evaluateExecutorCallTeamPolicy(policy, { code: slackRead }).allowed,
    ).toBe(false)
    expect(
      evaluateExecutorCallTeamPolicy(NO_TEAM_AGENT_POLICY, { code: slackRead })
        .allowed,
    ).toBe(true)
  })
})
