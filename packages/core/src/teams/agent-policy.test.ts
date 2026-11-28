import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEAM_AGENT_POLICY,
  NO_TEAM_AGENT_POLICY,
  TeamAgentPolicySchema,
  combineTeamAgentPolicies,
  evaluateTeamToolPolicy,
  teamApprovalRequirement,
  type TeamAgentPolicy,
} from './agent-policy'

const policy = (overrides: Partial<TeamAgentPolicy>): TeamAgentPolicy => ({
  ...DEFAULT_TEAM_AGENT_POLICY,
  ...overrides,
})

const finance = { teamId: 't-fin', teamName: 'Finance' }
const technical = { teamId: 't-tech', teamName: 'Technical' }

describe('TeamAgentPolicySchema', () => {
  it('accepts the default policy', () => {
    expect(TeamAgentPolicySchema.parse(DEFAULT_TEAM_AGENT_POLICY)).toEqual(
      DEFAULT_TEAM_AGENT_POLICY,
    )
  })

  it.each([
    ['unknown area', { allowed_areas: ['chats'] }],
    ['Home area', { allowed_areas: ['home'] }],
    ['write as a blocked class', { blocked_risk_classes: ['write'] }],
    ['unknown blocked class', { blocked_risk_classes: ['manage_billing'] }],
    ['unknown approval class', { approval_required: ['deploy_changes'] }],
    ['extra key', { admin_policy: { retention_days: 30 } }],
  ])('rejects %s', (_label, overrides) => {
    expect(
      TeamAgentPolicySchema.safeParse({
        ...DEFAULT_TEAM_AGENT_POLICY,
        ...overrides,
      }).success,
    ).toBe(false)
  })
})

describe('combineTeamAgentPolicies', () => {
  it('leaves a user on no Team unaffected', () => {
    expect(
      evaluateTeamToolPolicy(NO_TEAM_AGENT_POLICY, {
        area: 'connections',
        connectorId: 'github',
        riskClass: 'destructive',
      }),
    ).toEqual({ allowed: true })
    expect(teamApprovalRequirement(NO_TEAM_AGENT_POLICY, 'write')).toBeNull()
  })

  it('gives a user on two Teams the union of blocks', () => {
    const effective = combineTeamAgentPolicies([
      {
        ...technical,
        policy: policy({ allowed_areas: ['tasks', 'connections'] }),
      },
      {
        ...finance,
        policy: policy({ blocked_connector_ids: ['github'] }),
      },
    ])
    expect(
      evaluateTeamToolPolicy(effective, {
        area: 'knowledge',
        connectorId: null,
        riskClass: null,
      }),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('Technical'),
    })
    expect(
      evaluateTeamToolPolicy(effective, {
        area: 'connections',
        connectorId: 'github',
        riskClass: 'read',
      }),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('Finance'),
    })
    expect(
      evaluateTeamToolPolicy(effective, {
        area: 'connections',
        connectorId: 'slack',
        riskClass: 'read',
      }),
    ).toEqual({ allowed: true })
  })

  it('blocks a risk class any Team blocks', () => {
    const effective = combineTeamAgentPolicies([
      { ...finance, policy: policy({ blocked_risk_classes: ['destructive'] }) },
      { ...technical, policy: DEFAULT_TEAM_AGENT_POLICY },
    ])
    expect(
      evaluateTeamToolPolicy(effective, {
        area: 'connections',
        connectorId: 'github',
        riskClass: 'destructive',
      }).allowed,
    ).toBe(false)
    expect(
      evaluateTeamToolPolicy(effective, {
        area: 'connections',
        connectorId: 'github',
        riskClass: 'write',
      }).allowed,
    ).toBe(true)
  })

  it('always allows untagged tools', () => {
    const effective = combineTeamAgentPolicies([
      { ...finance, policy: policy({ allowed_areas: [] }) },
    ])
    expect(
      evaluateTeamToolPolicy(effective, {
        area: null,
        connectorId: null,
        riskClass: null,
      }),
    ).toEqual({ allowed: true })
  })

  it('names the first Team by name and lists the rest for approvals', () => {
    const effective = combineTeamAgentPolicies([
      {
        ...technical,
        policy: policy({ approval_required: ['send_external'] }),
      },
      { ...finance, policy: policy({ approval_required: ['send_external'] }) },
    ])
    expect(teamApprovalRequirement(effective, 'send_external')).toEqual({
      team: finance,
      otherTeams: [technical],
    })
    expect(teamApprovalRequirement(effective, 'write')).toBeNull()
    expect(teamApprovalRequirement(effective, 'read')).toBeNull()
  })
})
