// @vitest-environment node
import { PgDialect } from 'drizzle-orm/pg-core'
import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutorCatalog } from './executor-runtime'
import {
  executorToolsForCapabilitySync,
  syncCapabilities,
} from './capability-sync'
import { schema } from './db'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  loadExecutorCatalog: vi.fn(),
}))

vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: mocks.getDb,
}))

vi.mock('./executor-runtime', async (importOriginal) => ({
  ...(await importOriginal()),
  loadExecutorCatalog: mocks.loadExecutorCatalog,
}))

const orgTool = {
  address: 'tools.google_drive.org.company.list_files',
  name: 'list_files',
  description: 'List files',
  integration: 'google_drive',
  connection: 'company',
  owner: 'org',
  requiresApproval: false,
  mayElicit: false,
} satisfies ExecutorCatalog['tools'][number]

describe('Executor capability discovery', () => {
  it('includes an org-only connection without a personal duplicate', () => {
    expect(executorToolsForCapabilitySync([orgTool], 'google_drive')).toEqual([
      orgTool,
    ])
  })

  it('keeps the stricter catalog approval for a shared tool name', () => {
    const personalTool = {
      ...orgTool,
      address: 'tools.google_drive.user.personal.list_files',
      connection: 'personal',
      owner: 'user',
      requiresApproval: true,
    } satisfies ExecutorCatalog['tools'][number]

    expect(
      executorToolsForCapabilitySync([personalTool, orgTool], 'google_drive'),
    ).toEqual([personalTool])
    expect(
      executorToolsForCapabilitySync([orgTool, personalTool], 'google_drive'),
    ).toEqual([personalTool])
  })
})

describe('capability persistence boundaries', () => {
  const dialect = new PgDialect()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function fakeDb(
    existing: Array<{ id: string; name: string; riskClass: string }>,
  ) {
    const upserts: Array<{
      table: unknown
      row: unknown
      set: Record<string, unknown>
    }> = []
    const deletes: unknown[] = []
    const grants: unknown[] = []
    const db = {
      insert: (table: unknown) => ({
        values: (row: unknown) => ({
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
            upserts.push({ table, row, set })
            return Promise.resolve()
          },
          onConflictDoNothing: () => {
            grants.push(row)
            return Promise.resolve()
          },
        }),
      }),
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            Promise.resolve(
              table === schema.capability
                ? existing
                : table === schema.agent
                  ? [{ id: 'agent-1' }]
                  : [],
            ),
        }),
      }),
      delete: (table: unknown) => ({
        where: () => {
          deletes.push(table)
          return Promise.resolve()
        },
      }),
    }
    mocks.getDb.mockReturnValue(db)
    return { upserts, deletes, grants }
  }

  it('keeps stored tools and their dependent rows when another workspace sees a subset', async () => {
    const writes = fakeDb([
      { id: 'visible-id', name: 'list_files', riskClass: 'send_external' },
      {
        id: 'other-id',
        name: 'other_workspace_tool',
        riskClass: 'destructive',
      },
    ])
    mocks.loadExecutorCatalog.mockReturnValue(
      Effect.succeed({ tools: [orgTool] }),
    )

    await Effect.runPromise(
      syncCapabilities('google-drive', 'user-1', 'workspace-1'),
    )

    expect(writes.deletes).toEqual([])
    expect(writes.upserts).toHaveLength(1)
    expect(writes.upserts[0]?.set).toHaveProperty('riskClass')
    expect(Object.keys(writes.upserts[0]?.set ?? {})).toEqual(['riskClass'])
    const riskSql = dialect.sqlToQuery(
      writes.upserts[0]?.set.riskClass as Parameters<
        typeof dialect.sqlToQuery
      >[0],
    )
    expect(riskSql.sql).toContain("= 'destructive' then 'destructive'")
    expect(riskSql.sql).toContain("= 'send_external' then 'send_external'")
    expect(riskSql.sql).toContain("= 'write' then 'write'")
    expect(riskSql.params).toEqual(['read', 'read', 'read'])
    expect(writes.grants).toHaveLength(1)
    expect(writes.grants[0]).toEqual([
      expect.objectContaining({ capabilityId: 'visible-id' }),
    ])
  })

  it('raises a shared risk when a tenant reports approval is required', async () => {
    const writes = fakeDb([
      { id: 'shared-id', name: 'list_files', riskClass: 'send_external' },
    ])
    mocks.loadExecutorCatalog.mockReturnValue(
      Effect.succeed({
        tools: [{ ...orgTool, requiresApproval: true }],
      }),
    )

    await Effect.runPromise(
      syncCapabilities('google-drive', 'user-1', 'workspace-1'),
    )

    const riskSql = dialect.sqlToQuery(
      writes.upserts[0]?.set.riskClass as Parameters<
        typeof dialect.sqlToQuery
      >[0],
    )
    expect(riskSql.params).toEqual([
      'send_external',
      'send_external',
      'send_external',
    ])
    expect(writes.deletes).toEqual([])
  })

  it('does not prune when a tenant returns no tools', async () => {
    const writes = fakeDb([
      { id: 'shared-id', name: 'list_files', riskClass: 'read' },
    ])
    mocks.loadExecutorCatalog.mockReturnValue(Effect.succeed({ tools: [] }))

    await Effect.runPromise(
      syncCapabilities('google-drive', 'user-1', 'workspace-1'),
    )

    expect(writes.upserts).toEqual([])
    expect(writes.deletes).toEqual([])
    expect(writes.grants).toEqual([])
  })

  it('still prunes stale rows when the source is the native registry', async () => {
    const writes = fakeDb([
      { id: 'current-id', name: 'list_issues', riskClass: 'read' },
      { id: 'stale-id', name: 'removed_native_tool', riskClass: 'read' },
    ])

    await Effect.runPromise(syncCapabilities('github', 'user-1', 'workspace-1'))

    expect(writes.deletes).toContain(schema.capability)
    expect(writes.deletes).toContain(schema.permissionGrant)
    expect(
      writes.upserts.some((upsert) => upsert.set.description !== undefined),
    ).toBe(true)
  })
})
