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
    const { Effect } = await import('effect')
    mockAddText.mockReturnValue(
      Effect.fail(new Error('G08_PRIVATE_WRITE_ERROR')),
    )
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
      { code: 'brain_write_failed' },
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      'G08_PRIVATE_WRITE_ERROR',
    )
    expect(insert).not.toHaveBeenCalled()
    expect(values).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('skips a claim differing only in surrounding whitespace', async () => {
    const { Effect } = await import('effect')
    mockSearch.mockReturnValue(
      Effect.succeed([
        {
          item: {
            id: 'item-1',
            label: 'Datastore',
            kind: 'decision',
            body: '  The org chose D1 as the primary datastore. ',
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

  it.each([
    [
      {
        body: 'Retention is now 30 days.',
        label: 'Retention is 90 days.',
        summary: 'Retention is 90 days.',
      },
      false,
    ],
    [{ body: '', label: 'Retention is 90 days.' }, false],
    [
      { summary: 'Retention is now 30 days.', label: 'Retention is 90 days.' },
      false,
    ],
    [{ summary: 'Retention is 90 days.', label: 'Retention policy' }, true],
    [{ label: 'Retention is 90 days.' }, true],
  ])(
    'compares authoritative stored content before metadata %j',
    async (item, duplicate) => {
      const { Effect } = await import('effect')
      mockSearch.mockReturnValue(Effect.succeed([{ item, score: 1 }]))
      mockAddText.mockReturnValue(Effect.succeed({ id: 'written' }))
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
        claim: 'Retention is 90 days.',
        kind: 'policy',
        confidence: 0.9,
        sensitive: false,
        scope: 'org',
      })
      expect(result).toEqual(
        duplicate
          ? { ok: true, action: 'skipped', reason: 'duplicate' }
          : { ok: true, action: 'written' },
      )
      expect(mockAddText).toHaveBeenCalledTimes(duplicate ? 0 : 1)
      expect(mockGetPooledDb).not.toHaveBeenCalled()
    },
  )

  for (const confidence of [0.5, 0.9])
    it.each([
      [
        'The callback path is /OAuth/Callback.',
        'The callback path is /oauth/callback.',
      ],
      ['The literal label is `A  B`.', 'The literal label is `A B`.'],
    ])(
      `preserves distinct fact content at confidence ${confidence}: %s`,
      async (first, second) => {
        const { Effect } = await import('effect')
        mockSearch
          .mockReturnValueOnce(Effect.succeed([]))
          .mockReturnValue(
            Effect.succeed([{ item: { label: first, body: first }, score: 1 }]),
          )
        mockAddText.mockReturnValue(Effect.succeed({ id: 'written' }))
        const returning = vi.fn().mockResolvedValue([{ id: 'proposal' }])
        const values = vi
          .fn()
          .mockReturnValue({ onConflictDoNothing: () => ({ returning }) })
        mockGetPooledDb.mockReturnValue({ insert: () => ({ values }) })
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
        for (const claim of [first, second]) {
          const result = await execute(tools.propose_brain_item, {
            claim,
            kind: 'policy',
            confidence,
            sensitive: false,
            scope: 'org',
          })
          expect(result).toMatchObject({
            ok: true,
            action: confidence < 0.75 ? 'proposed' : 'written',
          })
        }
        const hashes =
          confidence < 0.75
            ? values.mock.calls.map(([row]) => row.claimHash)
            : mockAddText.mock.calls.map(([input]) => input.canonical.value)
        expect(hashes).toHaveLength(2)
        expect(new Set(hashes).size).toBe(2)
      },
    )

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
    const returning = vi.fn().mockResolvedValue([{ id: 'proposal' }])
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
    expect(
      await propose('Use Postgres for durable workflow state.'),
    ).toMatchObject({ action: 'proposed' })
    const [firstWrite, changedWrite] = values.mock.calls.map(([value]) => value)
    expect(firstWrite.claimHash).not.toBe(changedWrite.claimHash)
  })
})

describe('writeback originating grant boundaries', () => {
  const context = {
    workspaceId: 'workspace-1',
    agentId: 'agent-1',
    runId: 'run-1',
    userId: 'owner-1',
    readAudience: 'org' as const,
  }
  const candidate = {
    claim: 'Durable org policy.',
    kind: 'policy',
    confidence: 0.9,
    sensitive: false,
    scope: 'org',
  }
  const makeTools = (getContext: (tool?: string) => typeof context | null) =>
    createBrainWriteBackTools({
      env: { HELIX_URL: 'http://localhost:6968' },
      ai: { run: async () => ({ data: [] }) },
      files: { get: async () => null },
      databaseUrl: 'postgres://fixture',
      getContext,
    })
  beforeEach(async () => {
    vi.clearAllMocks()
    const { Effect } = await import('effect')
    mockSearch.mockReturnValue(Effect.succeed([]))
    mockAddText.mockReturnValue(Effect.succeed({ id: 'written' }))
  })
  it('read-only grants cannot start a proposal or its duplicate lookup', async () => {
    const result = await execute(
      makeTools((tool) => (tool === 'brain_search' ? context : null))
        .propose_brain_item,
      candidate,
    )
    expect(result.ok).toBe(false)
    expect(mockSearch).not.toHaveBeenCalled()
    expect(mockAddText).not.toHaveBeenCalled()
    expect(mockGetPooledDb).not.toHaveBeenCalled()
  })
  it('write-only grants do not implicitly authorize deduplication reads', async () => {
    const result = await execute(
      makeTools((tool) => (tool === 'add_to_brain' ? context : null))
        .propose_brain_item,
      candidate,
    )
    expect(result).toEqual({ ok: false, error: 'Brain read is not permitted.' })
    expect(mockSearch).not.toHaveBeenCalled()
    expect(mockAddText).not.toHaveBeenCalled()
  })
  it.each([0.5, 0.9])(
    'revocation during dedupe prevents persistence at confidence %s',
    async (confidence) => {
      let writes = 0
      const result = await execute(
        makeTools((tool) =>
          tool !== 'add_to_brain' || ++writes === 1 ? context : null,
        ).propose_brain_item,
        { ...candidate, confidence },
      )
      expect(result).toEqual({
        ok: false,
        error: 'Brain write is not permitted.',
      })
      expect(mockSearch).toHaveBeenCalledTimes(1)
      expect(mockAddText).not.toHaveBeenCalled()
      expect(mockGetPooledDb).not.toHaveBeenCalled()
    },
  )
  it('shared user-scoped claims keep attribution without owner-private dedupe', async () => {
    const values = vi.fn().mockReturnValue({
      onConflictDoNothing: () => ({
        returning: async () => [{ id: 'proposal' }],
      }),
    })
    mockGetPooledDb.mockReturnValue({ insert: () => ({ values }) })
    expect(
      await execute(makeTools(() => context).propose_brain_item, {
        ...candidate,
        scope: 'user',
      }),
    ).toEqual({ ok: true, action: 'submitted' })
    expect(mockSearch.mock.calls[0]![0].viewer).toBeUndefined()
    expect(values.mock.calls[0]![0].scope).toEqual({
      kind: 'user',
      userId: 'owner-1',
    })
    expect(values.mock.calls[0]![0].runId).toBe('run-1')
  })
})
