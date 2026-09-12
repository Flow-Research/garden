import { describe, expect, it } from 'vitest'
import {
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
    expect(
      filterSkillRowsByAllowedSlugs(
        [{ name: 'PDF' }],
        ['pdf'],
      ),
    ).toEqual([{ name: 'PDF' }])
    expect(isSkillAllowedBySlugs({ name: 'PDF' }, new Set(['pdf']))).toBe(true)
  })

  it('drops rows outside the list', () => {
    expect(filterSkillRowsByAllowedSlugs(rows, ['pdf'])).toEqual([rows[0]])
    expect(filterSkillRowsByAllowedSlugs(rows, ['nothing'])).toEqual([])
  })

  it('prefers the canonical slug over the display name', () => {
    expect(
      filterSkillRowsByAllowedSlugs([{ name: 'PDF', slug: 'report' }], [
        'pdf',
      ]),
    ).toEqual([])
    expect(isSkillAllowedBySlugs({ name: 'PDF', slug: 'report' }, new Set(['pdf']))).toBe(
      false,
    )
  })
})
