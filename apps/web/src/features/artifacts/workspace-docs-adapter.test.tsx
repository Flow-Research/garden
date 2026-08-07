import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  DocumentArtifactEvent,
  DocumentOperationOutcome,
  DocumentSnapshot,
} from '@garden/agent-runtime/src/documents/document-artifact-model'
import {
  WorkspaceDocsAdapter,
  toWorkspaceDocsOperationResult,
} from './workspace-docs-adapter'
import {
  WorkspaceDocsEditor,
  workspaceDocsFrameSource,
} from './workspace-docs-editor'

const snapshot: DocumentSnapshot = {
  revision: 3,
  title: 'Editable brief',
  blocks: [
    {
      id: 'block-1',
      html: '<p data-block-id="block-1">Draft</p>',
      version: 2,
    },
  ],
  lastModified: 1_786_140_000_000,
}

describe('Workspace Docs source host', () => {
  it('mounts the complete upstream command surface instead of reconstructed controls', () => {
    const source = workspaceDocsFrameSource()

    expect(source).toContain('Bold (Ctrl+B)')
    expect(source).toContain('Italic (Ctrl+I)')
    expect(source).toContain('Underline (Ctrl+U)')
    expect(source).toContain('Text color')
    expect(source).toContain('Highlight color')
    expect(source).toContain('Bulleted list')
    expect(source).toContain('Numbered list')
    expect(source).toContain('Insert image')
    expect(source).toContain('Clear formatting')
    expect(source.indexOf('class: "topbar"')).toBeLessThan(
      source.indexOf('class: "toolbar"'),
    )
    expect(source.indexOf('class: "toolbar"')).toBeLessThan(
      source.indexOf('class: "canvas"'),
    )

    render(
      <WorkspaceDocsEditor
        documentId="document-1"
        initialSnapshot={snapshot}
      />,
    )
    const frame = screen.getByTitle<HTMLIFrameElement>('Document editor')
    expect(frame.getAttribute('srcdoc')).toBe(source)
    expect(frame).toHaveClass('flex-1')
  })
})

describe('WorkspaceDocsAdapter', () => {
  it('maps operations to Garden POST input and upstream save results', async () => {
    const outcome: DocumentOperationOutcome = {
      _tag: 'Applied',
      snapshot: { ...snapshot, revision: 4 },
      accepted: [
        {
          id: 'block-1',
          html: '<p data-block-id="block-1"><b>Draft</b></p>',
          version: 3,
        },
      ],
      deletedIds: [],
    }
    const applyOperation = vi.fn(async () => outcome)
    const adapter = new WorkspaceDocsAdapter({
      documentId: 'document-1',
      dependencies: {
        applyOperation,
        getSnapshot: vi.fn(async () => snapshot),
        subscribe: vi.fn(() => () => undefined),
      },
    })

    const result = await adapter.applyOperation({
      operationId: 'operation-1',
      senderId: 'editor-1',
      baseRevision: 3,
      upserts: [
        {
          id: 'block-1',
          html: '<p data-block-id="block-1"><b>Draft</b></p>',
          baseVersion: 2,
        },
      ],
      deletes: [],
      order: ['block-1'],
      title: 'Editable brief',
    })

    expect(applyOperation).toHaveBeenCalledWith({
      documentId: 'document-1',
      operation: expect.objectContaining({ operationId: 'operation-1' }),
    })
    expect(result).toEqual({
      status: 'applied',
      revision: 4,
      title: 'Editable brief',
      upserts: outcome.accepted,
      deletedIds: [],
      conflicts: [],
    })
  })

  it('reuses loader state once, then reloads GET authority and replaces SSE', async () => {
    const refreshed = { ...snapshot, revision: 4, title: 'Reloaded' }
    const firstCleanup = vi.fn()
    const secondCleanup = vi.fn()
    let emit: ((event: DocumentArtifactEvent) => void) | undefined
    const subscribe = vi.fn(
      (args: {
        documentId: string
        onEvent: (event: DocumentArtifactEvent) => void
      }) => {
        emit = args.onEvent
        return subscribe.mock.calls.length === 1 ? firstCleanup : secondCleanup
      },
    )
    const getSnapshot = vi.fn(async () => refreshed)
    const adapter = new WorkspaceDocsAdapter({
      documentId: 'document-1',
      initialSnapshot: snapshot,
      dependencies: {
        applyOperation: vi.fn(),
        getSnapshot,
        subscribe,
      },
    })
    const pushed = vi.fn()

    await expect(adapter.subscribe(pushed)).resolves.toBe(snapshot)
    expect(getSnapshot).not.toHaveBeenCalled()
    await expect(adapter.subscribe(pushed)).resolves.toBe(refreshed)
    expect(firstCleanup).toHaveBeenCalledOnce()
    expect(getSnapshot).toHaveBeenCalledWith('document-1')

    emit?.({
      _tag: 'Operation',
      documentId: 'document-1',
      operationId: 'operation-2',
      senderId: 'editor-2',
      revision: 5,
      title: 'Live',
      upserts: snapshot.blocks,
      deletedIds: [],
      order: ['block-1'],
      lastModified: snapshot.lastModified + 1,
    })
    expect(pushed).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'operation',
        revision: 5,
        title: 'Live',
      }),
    )

    adapter.dispose()
    expect(secondCleanup).toHaveBeenCalledOnce()
  })

  it('maps conflicts without hiding accepted blocks', () => {
    const outcome: DocumentOperationOutcome = {
      _tag: 'Conflict',
      snapshot,
      committed: true,
      accepted: snapshot.blocks,
      deletedIds: ['old-block'],
      conflicts: snapshot.blocks,
    }

    expect(toWorkspaceDocsOperationResult(outcome)).toMatchObject({
      status: 'conflict',
      revision: snapshot.revision,
      upserts: snapshot.blocks,
      deletedIds: ['old-block'],
      conflicts: snapshot.blocks,
    })
  })
})
