import { Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'

const assignmentState = vi.hoisted(() => ({
  rows: [{ name: 'Review', slug: 'review' }],
  chatRows: [
    { workspaceId: 'workspace-1', agentId: 'agent-1', isDefault: true },
  ],
}))

vi.mock('@garden/db/runtime', () => ({
  getPooledDb: () => ({
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        innerJoin: () => ({
          where: () =>
            'isDefault' in fields
              ? { limit: async () => assignmentState.chatRows }
              : Promise.resolve(assignmentState.rows),
        }),
      }),
    }),
  }),
}))

vi.mock('agents/skills', () => ({
  r2: (
    _bucket: R2Bucket,
    options: { id: string; prefix: string; refreshIntervalMs?: number },
  ) => ({
    id: options.id,
    fingerprint: options.id,
    list: async () => [
      { name: 'Review', description: 'Review code', sourceId: options.id },
      { name: 'Write', description: 'Write copy', sourceId: options.id },
    ],
    load: async (name: string) => ({
      name,
      description: name,
      body: '',
      sourceId: options.id,
    }),
    readResource: async () => null,
    refresh: async () => undefined,
  }),
}))

const {
  loadRuntimeSkillSources,
  RuntimeSkillEnvironment,
  RuntimeSkillSources,
  runtimeSkillSourcesLayer,
  workspaceSkillObjectKey,
  workspaceSkillR2Prefix,
} = await import('./skills')

const environment = {
  bucket: {} as R2Bucket,
  databaseUrl: 'postgres://unused',
}

describe('target-scoped Garden skill sources', () => {
  it('builds canonical workspace R2 keys', () => {
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

  it('uses the canonical workspace source before built-ins', async () => {
    const sources = await loadRuntimeSkillSources(environment, {
      kind: 'target',
      workspaceId: 'workspace-1',
      target: { kind: 'agent', id: 'agent-1' },
    })

    expect(sources.map((source) => source.id)).toEqual([
      'garden-workspace:workspace-1',
      'garden-builtins',
    ])
  })

  it('maps default chat to workspace scope and specialist chat to agent scope', async () => {
    const layer = runtimeSkillSourcesLayer.pipe(
      Layer.provide(Layer.succeed(RuntimeSkillEnvironment, environment)),
    )
    const resolve = () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* RuntimeSkillSources
          return yield* sources.identity({ kind: 'chat', id: 'thread-1' })
        }).pipe(Effect.provide(layer)),
      )

    await expect(resolve()).resolves.toEqual({
      workspaceId: 'workspace-1',
      target: { kind: 'workspace_chat', id: 'workspace-1' },
    })

    assignmentState.chatRows = [
      { workspaceId: 'workspace-1', agentId: 'agent-1', isDefault: false },
    ]
    await expect(resolve()).resolves.toEqual({
      workspaceId: 'workspace-1',
      target: { kind: 'agent', id: 'agent-1' },
    })
  })

  it('refreshes assignment filters without copying R2 bundles', async () => {
    const [workspaceSource] = await loadRuntimeSkillSources(environment, {
      kind: 'target',
      workspaceId: 'workspace-1',
      target: { kind: 'agent', id: 'agent-1' },
    })
    if (!workspaceSource) throw new Error('Workspace source missing')
    expect((await workspaceSource.list()).map((skill) => skill.name)).toEqual([
      'Review',
    ])

    assignmentState.rows = [{ name: 'Write', slug: 'write' }]
    await workspaceSource.refresh?.()

    expect((await workspaceSource.list()).map((skill) => skill.name)).toEqual([
      'Write',
    ])
  })
})
