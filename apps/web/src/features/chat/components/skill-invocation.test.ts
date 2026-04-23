import { describe, expect, it } from 'vitest'
import {
  detectSkillTrigger,
  extractExplicitSkillSlugs,
  formatSkillInvocation,
} from './skill-invocation'

describe('skill invocation helpers', () => {
  it('formats manual invocation as a slash command', () => {
    expect(formatSkillInvocation('planning-with-files')).toBe(
      '/skill planning-with-files',
    )
  })

  it('detects slash skill triggers while typing', () => {
    expect(detectSkillTrigger('/skill plan', '/skill plan'.length)).toEqual({
      query: 'plan',
      rangeStart: 0,
      rangeEnd: '/skill plan'.length,
    })
  })

  it('extracts explicit slash-invoked skills from message text', () => {
    expect(
      extractExplicitSkillSlugs(
        'Use /skill planning-with-files then /skill humanizer before reply',
      ),
    ).toEqual(['planning-with-files', 'humanizer'])
  })

  it('ignores deprecated dollar-prefixed tokens', () => {
    expect(extractExplicitSkillSlugs('Use $planning-with-files instead')).toEqual([])
  })
})
