import { describe, expect, it, vi } from 'vitest'
import { createBrainWriteBackTools } from './brain-write-back'

const mockGetPooledDb = vi.hoisted(() => vi.fn())

vi.mock('@garden/db/runtime', () => ({ getPooledDb: mockGetPooledDb }))

vi.mock('@garden/brain/services/worker', async () => {
  const { Effect, Layer } = await import('effect')
  const { Brain } = await import('@garden/brain/services/brain')
  return {
    makeWorkerBrainLive: () =>
      Layer.succeed(Brain, {
        addText: () => Effect.fail(new Error('helix unavailable')),
      } as never),
  }
})

const execute = async (
  tool: { execute?: (input: never, options: never) => unknown } | undefined,
  input: unknown,
) =>
  (await tool?.execute?.(
    input as never,
    {
      toolCallId: 'call-1',
      messages: [],
    } as never,
  )) as Record<string, unknown>

describe('createBrainWriteBackTools user scope without user context', () => {
  it('skips a user-scoped candidate with no userId and writes nothing', async () => {
    const values = vi.fn().mockResolvedValue([])
    const insert = vi.fn().mockReturnValue({ values })
    mockGetPooledDb.mockReturnValue({ insert })
    const tools = createBrainWriteBackTools({
      env: {},
      ai: { run: async () => ({ data: [] }) },
      files: { get: async () => null },
      databaseUrl: 'postgres://test:test@localhost:5432/test',
      getContext: () => ({
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        runId: 'run-1',
      }),
    })

    const result = await execute(tools.propose_brain_item, {
      claim: 'Alice prefers short replies.',
      kind: 'preference',
      confidence: 0.9,
      sensitive: false,
      scope: 'user',
    })

    expect(result).toMatchObject({ ok: true, action: 'skipped' })
    expect(mockGetPooledDb).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(values).not.toHaveBeenCalled()
  })

  it('reports a failed direct write instead of claiming success', async () => {
    const values = vi.fn().mockResolvedValue([])
    const insert = vi.fn().mockReturnValue({ values })
    mockGetPooledDb.mockReturnValue({ insert })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tools = createBrainWriteBackTools({
      env: { HELIX_URL: 'http://localhost:6968' },
      ai: { run: async () => ({ data: [] }) },
      files: { get: async () => null },
      databaseUrl: 'postgres://test:test@localhost:5432/test',
      getContext: () => ({
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        runId: 'run-1',
      }),
    })

    const result = await execute(tools.propose_brain_item, {
      claim: 'The org chose D1 as the primary datastore.',
      kind: 'decision',
      confidence: 0.9,
      sensitive: false,
      scope: 'org',
    })

    expect(result).toEqual({ ok: false, error: 'Brain write failed.' })
    expect(warn).toHaveBeenCalledWith(
      '[brain-write-back] direct write failed',
      expect.anything(),
    )
    expect(insert).not.toHaveBeenCalled()
    expect(values).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
