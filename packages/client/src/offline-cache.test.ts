import { describe, expect, it } from 'vitest'
import { chatFacetPath } from './client'
import {
  decodeOfflineSnapshot,
  offlineCacheMaxCharacters,
  type OfflineSnapshot,
} from './offline-cache'

const saved: OfflineSnapshot = {
  version: 1,
  origin: 'https://garden.test',
  accountId: 'alice',
  workspaceId: 'workspace',
  syncedAt: 1000,
  expiresAt: 2000,
  workspaces: [{ id: 'workspace', name: 'Private workspace' }],
  tasks: [
    {
      id: 'issue',
      workspace_id: 'workspace',
      title: 'Private task',
      identifier: 'A-1',
      status: 'todo',
      updated_at: '2026-11-21T00:00:00Z',
    },
  ],
  threads: [
    { id: 'thread', workspaceId: 'workspace', title: 'Private conversation' },
  ],
  run: {
    id: 'run',
    workspace_id: 'workspace',
    issue_id: 'issue',
    status: 'running',
    updated_at: '2026-11-21T00:00:00Z',
    cancel_requested_at: null,
    finished_at: null,
  },
  selectedTaskId: 'issue',
  selectedRunId: 'run',
  skillsCount: 3,
}

describe('portable private-read snapshot contract', () => {
  it('retains the server deadline and identities while stripping unknown credential fields', () => {
    const decoded = decodeOfflineSnapshot(
      JSON.stringify({
        ...saved,
        cookie: 'must not enter view state',
        tasks: saved.tasks.map((task) => ({
          ...task,
          secret: 'not a projection',
        })),
      }),
    )
    expect(decoded.unwrap()).toEqual(saved)
  })

  it.each([
    { ...saved, version: 2 },
    { ...saved, origin: 'https://alice:password@garden.test' },
    { ...saved, expiresAt: 1000 },
    {
      ...saved,
      tasks: [{ ...saved.tasks[0], workspace_id: 'other-workspace' }],
    },
    {
      ...saved,
      threads: [{ ...saved.threads[0], workspaceId: 'other-workspace' }],
    },
    { ...saved, run: { ...saved.run, issue_id: 'other-issue' } },
    { ...saved, run: { ...saved.run, id: 'other-run' } },
    { ...saved, selectedTaskId: 'missing-issue' },
  ])(
    'refuses a snapshot that cannot establish a coherent saved scope: %#',
    (snapshot) => {
      expect(decodeOfflineSnapshot(JSON.stringify(snapshot)).isErr()).toBe(true)
    },
  )

  it('refuses corrupt and excessive device input without throwing', () => {
    expect(decodeOfflineSnapshot('{corrupt').isErr()).toBe(true)
    const result = decodeOfflineSnapshot(
      'x'.repeat(offlineCacheMaxCharacters + 1),
    )
    expect(
      result.match({ ok: () => '', err: (error) => error.message }),
    ).toContain('device limit')
  })

  it('accepts a scope without a selected run and encodes only the owned chat route', () => {
    expect(
      decodeOfflineSnapshot(
        JSON.stringify({
          ...saved,
          run: null,
          selectedTaskId: null,
          selectedRunId: null,
        }),
      ).isOk(),
    ).toBe(true)
    expect(
      chatFacetPath({
        id: 'thread',
        workspaceId: 'workspace',
        ownerUserId: 'alice',
        title: 'Chat',
        hostName: 'host:instance',
        runtime_kind: 'chat',
        runtime_key: '10000000-0000-4000-8000-000000000001',
      }),
    ).toBe(
      '/agents/agent-d-o/host%3Ainstance/sub/chat-sub-agent/10000000-0000-4000-8000-000000000001',
    )
  })
})
