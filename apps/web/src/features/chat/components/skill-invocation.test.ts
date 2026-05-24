import { describe, expect, it } from 'vitest'
import {
  detectSkillTrigger,
  extractExplicitSkillSlugs,
  formatSkillInvocation,
  stripExplicitSkills,
} from './skill-invocation'

describe('skill invocation helpers', () => {
  it('formats manual invocation as a direct slash command', () => {
    expect(formatSkillInvocation('planning-with-files')).toBe(
      '/planning-with-files',
    )
  })

  it('detects slash triggers while typing', () => {
    expect(detectSkillTrigger('/plan', '/plan'.length)).toEqual({
      query: 'plan',
      rangeStart: 0,
      rangeEnd: '/plan'.length,
    })
  })

  it('opens the menu on a bare slash', () => {
    expect(detectSkillTrigger('/', 1)).toEqual({
      query: '',
      rangeStart: 0,
      rangeEnd: 1,
    })
  })

  it('extracts explicit slash-invoked skills from message text', () => {
    expect(
      extractExplicitSkillSlugs(
        'Use /planning-with-files then /humanizer before reply',
      ),
    ).toEqual(['planning-with-files', 'humanizer'])
  })

  it('ignores deprecated dollar-prefixed tokens', () => {
    expect(
      extractExplicitSkillSlugs('Use $planning-with-files instead'),
    ).toEqual([])
  })

  it('strips explicit skill invocations and returns slugs plus cleaned text', () => {
    expect(
      stripExplicitSkills(
        'Use /planning-with-files then /humanizer before reply',
      ),
    ).toEqual({
      slugs: ['planning-with-files', 'humanizer'],
      cleaned: 'Use then before reply',
    })
  })

  it('returns empty slugs and original text when no skills are present', () => {
    expect(stripExplicitSkills('Hello world')).toEqual({
      slugs: [],
      cleaned: 'Hello world',
    })
  })
})
