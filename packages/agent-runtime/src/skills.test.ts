import { describe, expect, it } from 'vitest'
import {
  workspaceSkillObjectKey,
  workspaceSkillR2Prefix,
} from './skill-storage-paths'

describe('target-scoped Garden skill sources', () => {
  it('builds canonical workspace R2 keys', () => {
    expect(workspaceSkillR2Prefix('workspace-1')).toBe(
      'agent-skills/workspaces/workspace-1/',
    )
    expect(
      workspaceSkillObjectKey({
        workspaceId: 'workspace-1',
        slug: 'pdf',
        path: 'SKILL.md',
      }),
    ).toBe('agent-skills/workspaces/workspace-1/pdf/SKILL.md')
  })
})
