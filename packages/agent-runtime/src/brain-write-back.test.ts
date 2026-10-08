import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrainWriteBackTools } from './brain-write-back'

const mockGetPooledDb = vi.hoisted(() => vi.fn())
const mockSearch = vi.hoisted(() => vi.fn())
const mockAddText = vi.hoisted(() => vi.fn())

vi.mock('@garden/db/runtime', () => ({ getPooledDb: mockGetPooledDb }))

vi.mock('@garden/brain/services/worker', async () => {
  const { Layer } = await import('effect')
  const { Brain } = await import('@garden/brain/services/brain')
  return {
    makeWorkerBrainLive: () =>
      Layer.succeed(Brain, {
        search: (...args: unknown[]) => mockSearch(...args),
        addText: (...args: unknown[]) => mockAddText(...args),
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
  beforeEach(async () => {
    vi.clearAllMocks()
    const { Effect } = await import('effect')
    mockSearch.mockReturnValue(Effect.succeed([]))
    mockAddText.mockReturnValue(Effect.fail(new Error('helix unavailable')))
  })

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

  it('skips an equivalent claim already present in the brain', async () => {
    const { Effect } = await import('effect')
    mockSearch.mockReturnValue(
      Effect.succeed([
        {
          item: {
            id: 'item-1',
            label: 'Datastore',
            kind: 'decision',
            body: '  THE ORG CHOSE D1 as the primary datastore. ',
          },
          score: 1,
        },
      ]),
    )
    const tools = createBrainWriteBackTools({
      env: { HELIX_URL: 'http://localhost:6968' },
      ai: { run: async () => ({ data: [] }) },
      files: { get: async () => null },
      databaseUrl: 'postgres://test:test@localhost:5432/test',
      getContext: () => ({
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        runId: 'run-2',
      }),
    })

    const result = await execute(tools.propose_brain_item, {
      claim: 'The org chose D1 as the primary datastore.',
      kind: 'decision',
      confidence: 0.9,
      sensitive: false,
      scope: 'org',
    })

    expect(result).toEqual({
      ok: true,
      action: 'skipped',
      reason: 'duplicate',
    })
    expect(mockAddText).not.toHaveBeenCalled()
    expect(mockGetPooledDb).not.toHaveBeenCalled()
  })

  it('uses one semantic identity across runs and a run-specific operation key', async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'proposal-1' }])
      .mockResolvedValueOnce([])
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning })
    const values = vi.fn().mockReturnValue({ onConflictDoNothing })
    mockGetPooledDb.mockReturnValue({
      insert: vi.fn().mockReturnValue({ values }),
      query: {
        brainWriteProposal: {
          findFirst: vi.fn().mockResolvedValue({ runId: 'run-1' }),
        },
      },
    })
    const makeTools = (runId: string) =>
      createBrainWriteBackTools({
        env: {},
        ai: { run: async () => ({ data: [] }) },
        files: { get: async () => null },
        databaseUrl: 'postgres://test:test@localhost:5432/test',
        getContext: () => ({
          workspaceId: 'workspace-1',
          agentId: 'agent-1',
          runId,
        }),
      })
    const input = {
      claim: 'Use D1 for durable workflow state.',
      kind: 'decision',
      confidence: 0.4,
      sensitive: false,
      scope: 'org' as const,
    }

    const first = await execute(makeTools('run-1').propose_brain_item, input)
    const duplicate = await execute(
      makeTools('run-2').propose_brain_item,
      input,
    )

    expect(first).toMatchObject({ ok: true, action: 'proposed' })
    expect(duplicate).toEqual({
      ok: true,
      action: 'skipped',
      reason: 'duplicate',
    })
    const [firstWrite, secondWrite] = values.mock.calls.map(([value]) => value)
    expect(firstWrite.claimHash).toBe(secondWrite.claimHash)
    expect(firstWrite.operationKey).not.toBe(secondWrite.operationKey)
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2)
  })

  it('identifies same-run proposal retries separately from cross-run duplicates', async () => {
    const returning = vi.fn().mockResolvedValue([])
    const values = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({ returning }),
    })
    mockGetPooledDb.mockReturnValue({
      insert: vi.fn().mockReturnValue({ values }),
      query: {
        brainWriteProposal: {
          findFirst: vi.fn().mockResolvedValue({ runId: 'run-1' }),
        },
      },
    })
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
      claim: 'Use D1 for durable workflow state.',
      kind: 'decision',
      confidence: 0.4,
      sensitive: false,
      scope: 'org',
    })

    expect(result).toEqual({
      ok: true,
      action: 'skipped',
      reason: 'retry',
    })
  })

  it('keeps genuinely changed facts persistable', async () => {
    const returning = vi
      .fn()
      .mockResolvedValue([{ id: 'proposal' }])
    const values = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({ returning }),
    })
    mockGetPooledDb.mockReturnValue({
      insert: vi.fn().mockReturnValue({ values }),
    })
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
    const propose = (claim: string) =>
      execute(tools.propose_brain_item, {
        claim,
        kind: 'decision',
        confidence: 0.4,
        sensitive: false,
        scope: 'org',
      })

    expect(await propose('Use D1 for durable workflow state.')).toMatchObject({
      action: 'proposed',
    })
    expect(await propose('Use Postgres for durable workflow state.')).toMatchObject(
      { action: 'proposed' },
    )
    const [firstWrite, changedWrite] = values.mock.calls.map(([value]) => value)
    expect(firstWrite.claimHash).not.toBe(changedWrite.claimHash)
  })
})
