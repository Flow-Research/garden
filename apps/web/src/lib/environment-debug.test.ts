import { describe, expect, it } from 'vitest'
import {
  createEnvironmentDebugSnapshot,
  environmentDebugSnapshotSpec,
} from './environment-debug'

const liveState = {
  agentName: 'chat:thread-123',
  requestedSessionId: null,
  effectiveSessionId: 'default',
  visibleSessionCount: 1,
  archivedSessionCount: 0,
  currentMessageCount: 2,
  currentPreview: 'Latest reply',
  sessions: [
    {
      id: 'default',
      title: 'New Chat',
      createdAt: '2026-04-21T12:00:00.000Z',
      updatedAt: '2026-04-21T12:01:00.000Z',
      lastMessage: 'Latest reply',
      messageCount: 2,
    },
  ],
  workspace: {
    rootEntries: [
      {
        path: '/workspace',
        name: 'workspace',
        type: 'directory',
        size: 0,
        mimeType: 'inode/directory',
        updatedAt: 1,
      },
    ],
    samplePaths: [],
  },
  sandbox: {
    id: 'sandbox-123',
    reachable: true,
    cwd: '/workspace',
    workspaceListing: 'README.md',
    currentDirectoryListing: 'README.md',
  },
} as const

describe('createEnvironmentDebugSnapshot', () => {
  it('copies live agent state into the snapshot', () => {
    const snapshot = createEnvironmentDebugSnapshot({
      workspaceId: 'workspace-123',
      liveState,
    })

    expect(snapshot.workspaceId).toBe('workspace-123')
    expect(snapshot.agent).toEqual({
      name: 'chat:thread-123',
      requestedSessionId: null,
      effectiveSessionId: 'default',
      visibleSessionCount: 1,
      archivedSessionCount: 0,
      currentMessageCount: 2,
      currentPreview: 'Latest reply',
    })
    expect(snapshot.sessions).toEqual(liveState.sessions)
    expect(snapshot.virtualFs.rootEntries).toEqual(liveState.workspace.rootEntries)
    expect(snapshot.sandbox).toEqual(
      expect.objectContaining({
        id: 'sandbox-123',
        reachable: true,
        cwd: '/workspace',
        workspaceListing: 'README.md',
        currentDirectoryListing: 'README.md',
      }),
    )
  })

  it('exposes the current debug spec metadata', () => {
    const snapshot = createEnvironmentDebugSnapshot({
      workspaceId: 'workspace-123',
      liveState,
    })

    expect(snapshot.sandbox.callableRpcMethods).toEqual(
      environmentDebugSnapshotSpec.callableRpcMethods,
    )
    expect(snapshot.sdks).toEqual(environmentDebugSnapshotSpec.sdks)
    expect(snapshot.virtualFs.backingStores).toEqual([
      'Durable Object SQLite',
      'R2 spillover via FILES binding',
    ])
  })
})
