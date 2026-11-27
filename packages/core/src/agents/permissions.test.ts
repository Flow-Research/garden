import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_PERMISSIONS,
  derivePermissions,
  evaluateToolPermission,
  type AgentPermissions,
} from './permissions'

describe('derivePermissions', () => {
  it('returns the default permission scope when no values are set', () => {
    expect(derivePermissions({ agent: {} })).toEqual(DEFAULT_AGENT_PERMISSIONS)
    expect(derivePermissions({ agent: { permissions: null } })).toEqual(
      DEFAULT_AGENT_PERMISSIONS,
    )
  })

  it('drops full access when stored permissions cannot be parsed', () => {
    const permissions = derivePermissions({
      agent: { permissions: { full_access: 'yes' } },
    })
    expect(permissions.full_access).toBe(false)
    expect(permissions.allowed_skills).toEqual([])
  })

  it('shallow-merges issue overrides over agent permissions', () => {
    expect(
      derivePermissions({
        agent: {
          permissions: {
            full_access: false,
            allowed_skills: ['research'],
            allowed_connectors: ['github'],
            allowed_tools: ['read_source'],
            approval_overrides: { destructive: 'manual' },
          },
        },
        issue: {
          permissionsOverride: {
            allowed_tools: ['post_comment'],
            approval_overrides: { send_external: 'auto' },
          },
        },
      }),
    ).toEqual({
      full_access: false,
      allowed_skills: ['research'],
      allowed_connectors: ['github'],
      allowed_tools: ['post_comment'],
      approval_overrides: {
        destructive: 'manual',
        send_external: 'auto',
      },
    })
  })
})

const RESTRICTED: AgentPermissions = {
  full_access: false,
  allowed_skills: ['research'],
  allowed_connectors: [],
  allowed_tools: [],
  approval_overrides: {},
}

const tool = (
  toolName: string,
  connectorId: string | null = null,
): Parameters<typeof evaluateToolPermission>[1] => ({
  toolName,
  runtimeToolName: connectorId ? `tool_${connectorId}_${toolName}` : toolName,
  connectorId,
})

describe('evaluateToolPermission', () => {
  it('allows everything with full access or no permissions', () => {
    expect(evaluateToolPermission(null, tool('create_issue')).allowed).toBe(
      true,
    )
    expect(
      evaluateToolPermission(DEFAULT_AGENT_PERMISSIONS, tool('x', 'slack'))
        .allowed,
    ).toBe(true)
  })

  it('treats empty tool and connector lists as no limit', () => {
    expect(
      evaluateToolPermission(RESTRICTED, tool('create_issue')).allowed,
    ).toBe(true)
    expect(
      evaluateToolPermission(RESTRICTED, tool('post_message', 'slack')).allowed,
    ).toBe(true)
  })

  it('restricts to listed tools and connectors when the lists have entries', () => {
    const listed = {
      ...RESTRICTED,
      allowed_tools: ['add_issue_comment'],
      allowed_connectors: ['github'],
    }
    expect(
      evaluateToolPermission(listed, tool('add_issue_comment', 'github')),
    ).toEqual({ allowed: true })
    expect(evaluateToolPermission(listed, tool('create_issue'))).toEqual({
      allowed: false,
      reason: 'Tool create_issue is not allowed for this agent.',
    })
    expect(
      evaluateToolPermission(
        { ...listed, allowed_tools: [] },
        tool('post_message', 'slack'),
      ),
    ).toEqual({
      allowed: false,
      reason: 'Connector slack is not allowed for this agent.',
    })
  })
})
