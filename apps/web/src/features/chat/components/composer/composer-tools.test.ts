import {
  DEFAULT_TOOL_PRESET_ID,
  SUGGESTION_PILLS,
  TOOL_PRESETS,
} from './composer-tools'

describe('composer-tools config', () => {
  it('lists the 6 tool presets in menu order, "default" first', () => {
    expect(TOOL_PRESETS.map((p) => p.id)).toEqual([
      'default',
      'qa-agent',
      'eng-issue-triage',
      'org-brain',
      'research-synthesis',
      'document-review',
    ])
    expect(DEFAULT_TOOL_PRESET_ID).toBe('default')
  })

  it('gives every preset an icon and an accent class', () => {
    for (const preset of TOOL_PRESETS) {
      expect(preset.icon).toBeTruthy()
      expect(preset.iconClassName.trim().length).toBeGreaterThan(0)
    }
  })

  it('tool preset ids are unique', () => {
    const ids = TOOL_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has 7 suggestion pills, each with a non-empty starter', () => {
    expect(SUGGESTION_PILLS).toHaveLength(7)
    for (const pill of SUGGESTION_PILLS) {
      expect(pill.starter.trim().length).toBeGreaterThan(0)
    }
  })

  it('suggestion pill ids are unique', () => {
    const ids = SUGGESTION_PILLS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
