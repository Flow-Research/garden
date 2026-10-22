import { describe, expect, it } from 'vitest'
import { DOC_BUILTIN_SKILL_REMINDER } from '../bundled-skills'
import { FOUNDATION_SECTION_ORDER, FOUNDATION_SECTIONS } from './base'

describe('foundation prompt sections', () => {
  it('loads every section from foundation.md with a body', () => {
    for (const id of FOUNDATION_SECTION_ORDER) {
      const section = FOUNDATION_SECTIONS[id]
      expect(section.id).toBe(id)
      expect(section.body.length).toBeGreaterThan(0)
      expect(section.body).not.toContain('\r')
      expect(section.body).not.toContain('{{')
    }
  })

  it('fills in the built-in document skill list', () => {
    expect(FOUNDATION_SECTIONS.skills.body).toContain(
      DOC_BUILTIN_SKILL_REMINDER,
    )
  })

  it('keeps markdown emphasis and example indentation verbatim', () => {
    expect(FOUNDATION_SECTIONS.voice.body).toContain('*Action asterisks*')
    expect(FOUNDATION_SECTIONS.examples.body).toContain(
      '\n  Good: "Hey. What\'s up?"',
    )
  })
})
