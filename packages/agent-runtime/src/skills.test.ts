import { describe, expect, it } from 'vitest'
import { SkillParseError, type SkillSource } from 'agents/skills'
import { AgentPermissionsSchema } from '@garden/core/agents/permissions'
import {
  filterBuiltinSkillSource,
  filterSkillRowsByAllowedSlugs,
  isSkillAllowedBySlugs,
} from './skills-filter'
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

describe('allowed_skills filtering', () => {
  const rows = [
    { name: 'PDF', slug: 'pdf' },
    { name: 'Spreadsheet', slug: 'xlsx' },
  ]

  it('passes everything through when unrestricted', () => {
    expect(filterSkillRowsByAllowedSlugs(rows, null)).toEqual(rows)
  })

  it('denies everything on an empty restricted list', () => {
    expect(filterSkillRowsByAllowedSlugs(rows, [])).toEqual([])
  })

  it('matches slugs case-insensitively', () => {
    expect(filterSkillRowsByAllowedSlugs(rows, ['PDF'])).toEqual([rows[0]])
  })

  it('matches names as an alias, mirroring slash-token resolution', () => {
    expect(filterSkillRowsByAllowedSlugs([{ name: 'PDF' }], ['pdf'])).toEqual([
      { name: 'PDF' },
    ])
    expect(isSkillAllowedBySlugs({ name: 'PDF' }, new Set(['pdf']))).toBe(true)
  })

  it('drops rows outside the list', () => {
    expect(filterSkillRowsByAllowedSlugs(rows, ['pdf'])).toEqual([rows[0]])
    expect(filterSkillRowsByAllowedSlugs(rows, ['nothing'])).toEqual([])
  })

  it('prefers the canonical slug over the display name', () => {
    expect(
      filterSkillRowsByAllowedSlugs([{ name: 'PDF', slug: 'report' }], ['pdf']),
    ).toEqual([])
    expect(
      isSkillAllowedBySlugs({ name: 'PDF', slug: 'report' }, new Set(['pdf'])),
    ).toBe(false)
  })
})

it('omits unverified skill paths from restricted lists', async () => {
  const invalid = {
    location: 'private/SKILL.md',
    error: new SkillParseError('invalid-name', 'Unsupported name'),
  }
  const source: SkillSource = {
    id: 'example',
    list: async () => ({ ok: true, value: { skills: [], invalid: [invalid] } }),
    readResource: async () => {
      throw new Error('No resources')
    },
  }
  const permissions = AgentPermissionsSchema.parse({
    full_access: false,
    allowed_skills: ['pdf'],
  })
  expect(await filterBuiltinSkillSource(source, permissions).list()).toEqual({
    ok: true,
    value: { skills: [], invalid: [] },
  })
  expect(filterBuiltinSkillSource(source, null)).toBe(source)
})
