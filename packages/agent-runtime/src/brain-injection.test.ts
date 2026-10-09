import { describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '@garden/brain/domain'
import { loadBrainInjection } from './brain-injection'

const injectionState = vi.hoisted(() => ({ hits: [] as unknown[] }))

vi.mock('@garden/brain/services/worker', async () => {
  const { Effect, Layer } = await import('effect')
  const { Brain } = await import('@garden/brain/services/brain')
  return {
    makeWorkerBrainLive: () =>
      Layer.succeed(Brain, {
        search: () => Effect.succeed(injectionState.hits),
      } as never),
  }
})

const makeHit = (input: {
  readonly id: string
  readonly score: number
  readonly rankScore: number
}): SearchHit =>
  ({
    item: {
      id: input.id,
      label: input.id,
      kind: 'note',
      origin: { actor: { _tag: 'Agent', agentId: 'a', runId: 'r' } },
    },
    score: input.score,
    rankScore: input.rankScore,
  }) as unknown as SearchHit

describe('loadBrainInjection freshness ranking', () => {
  it('injects the fresher hit over a stale hit with a higher fused score', async () => {
    injectionState.hits = [
      makeHit({ id: 'stale', score: 10, rankScore: 0.3 }),
      makeHit({ id: 'fresh', score: 0.4, rankScore: 1 }),
    ]

    const injection = await loadBrainInjection({
      env: { HELIX_URL: 'http://localhost:6968' },
      ai: { run: async () => ({ data: [] }) },
      files: { get: async () => null },
      workspaceId: 'workspace-1',
      viewer: { teamIds: new Set<string>(), userId: 'viewer-1' },
      query: 'protocol',
    })

    expect(injection.itemIds).toEqual(['fresh'])
  })
})
