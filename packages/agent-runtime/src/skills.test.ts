import { describe, expect, it, vi } from 'vitest'

vi.mock('agents/skills', () => ({
  r2: (
    _bucket: R2Bucket,
    options: { id: string; prefix: string; refreshIntervalMs?: number },
  ) => ({
    id: options.id,
    prefix: options.prefix,
    refreshIntervalMs: options.refreshIntervalMs,
    fingerprint: options.id,
    list: async () => [],
    load: async () => null,
    readResource: async () => null,
  }),
}))

const { createGardenSkillSources, workspaceSkillObjectKey, workspaceSkillR2Prefix } =
  await import('./skills')

describe('Think-native Garden skill sources', () => {
  it('builds stable workspace R2 keys used by the skill library', () => {
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

  it('returns only built-in source when agent identity is unavailable', () => {
    const sources = createGardenSkillSources({
      bucket: {} as R2Bucket,
      agentId: null,
    })

    expect(sources.map((source) => source.id)).toEqual(['garden-builtins'])
  })

  it('puts the per-agent source before built-ins so attached skills can override', () => {
    const sources = createGardenSkillSources({
      bucket: {} as R2Bucket,
      agentId: 'agent-1',
    })

    expect(sources.map((source) => source.id)).toEqual([
      'garden-agent:agent-1',
      'garden-builtins',
    ])
    expect((sources[0] as unknown as { prefix: string }).prefix).toBe(
      'agent-skills/agents/agent-1/',
    )
    expect(
      (sources[0] as unknown as { refreshIntervalMs: number }).refreshIntervalMs,
    ).toBe(0)
  })
})
