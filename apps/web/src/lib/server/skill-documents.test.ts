import { describe, expect, it } from 'vitest'
import {
  buildGardenSkillDocument,
  parseGardenSkillDocument,
  updateGardenSkillDocument,
} from './skill-documents'

describe('skill document helpers', () => {
  it('parses Agent Skills YAML frontmatter', () => {
    const result = parseGardenSkillDocument(
      '---\nname: review\ndescription: Review code\nmetadata:\n  tier: core\n---\n\n# Review',
    )

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.name).toBe('review')
    expect(result.value.description).toBe('Review code')
    expect(result.value.body).toContain('# Review')
    expect(result.value.frontmatter).toEqual({
      name: 'review',
      description: 'Review code',
      metadata: { tier: 'core' },
    })
  })

  it('rejects documents without required catalog fields', () => {
    const result = parseGardenSkillDocument('---\nname: review\n---\n# Review')

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error.message).toContain('name and description')
  })

  it('builds and updates SKILL.md without dropping the body', () => {
    const raw = buildGardenSkillDocument({
      name: 'review',
      description: 'Review code',
      body: '# Review',
      frontmatter: { metadata: { tier: 'core' } },
    })
    const updated = updateGardenSkillDocument({
      raw,
      description: 'Review pull requests',
      frontmatter: { compatibility: 'garden' },
    })

    expect(updated.isOk()).toBe(true)
    if (updated.isErr()) return
    expect(updated.value).toContain('name: review')
    expect(updated.value).toContain('description: Review pull requests')
    expect(updated.value).toContain('compatibility: garden')
    expect(updated.value).toContain('# Review')
  })
})
