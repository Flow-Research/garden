import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_PERMISSIONS, derivePermissions } from './permissions'

describe('derivePermissions', () => {
  it('returns the default permission scope when no values are set', () => {
    expect(derivePermissions({ agent: {} })).toEqual(DEFAULT_AGENT_PERMISSIONS)
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
