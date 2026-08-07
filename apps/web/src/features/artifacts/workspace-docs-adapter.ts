import type {
  DocumentArtifactEvent,
  DocumentOperation,
  DocumentOperationOutcome,
  DocumentSnapshot,
} from '@garden/agent-runtime/src/documents/document-artifact-model'
import {
  applyDocumentArtifactOperation,
  getDocumentArtifact,
  subscribeDocumentArtifactEvents,
} from '@/lib/api/documents'

export type WorkspaceDocsEvent =
  | {
      type: 'snapshot'
      senderId?: string
      document: DocumentSnapshot
    }
  | {
      type: 'operation'
      senderId: string
      revision: number
      title: string
      upserts: DocumentSnapshot['blocks']
      deletedIds: readonly string[]
      order: readonly string[]
      lastModified: number
    }

export type WorkspaceDocsOperationResult = {
  status: 'applied' | 'conflict' | 'unchanged'
  revision: number
  title: string
  upserts: DocumentSnapshot['blocks']
  deletedIds: readonly string[]
  conflicts: DocumentSnapshot['blocks']
}

type WorkspaceDocsOperation = Omit<DocumentOperation, 'operationId'> & {
  operationId?: string
}

type WorkspaceDocsAdapterDependencies = {
  applyOperation: typeof applyDocumentArtifactOperation
  getSnapshot: typeof getDocumentArtifact
  subscribe: typeof subscribeDocumentArtifactEvents
}

const defaultDependencies: WorkspaceDocsAdapterDependencies = {
  applyOperation: applyDocumentArtifactOperation,
  getSnapshot: getDocumentArtifact,
  subscribe: subscribeDocumentArtifactEvents,
}

/** Converts Garden's typed SSE events to the callback vocabulary used upstream. */
export function toWorkspaceDocsEvent(
  event: DocumentArtifactEvent,
): WorkspaceDocsEvent {
  if (event._tag === 'Snapshot') {
    return { type: 'snapshot', document: event.snapshot }
  }
  return {
    type: 'operation',
    senderId: event.senderId,
    revision: event.revision,
    title: event.title,
    upserts: event.upserts,
    deletedIds: event.deletedIds,
    order: event.order,
    lastModified: event.lastModified,
  }
}

/**
 * Converts idempotent Garden outcomes to the smaller result consumed by the
 * unmodified Workspace Docs save loop.
 */
export function toWorkspaceDocsOperationResult(
  outcome: DocumentOperationOutcome,
): WorkspaceDocsOperationResult {
  if (outcome._tag === 'Applied') {
    return {
      status: 'applied',
      revision: outcome.snapshot.revision,
      title: outcome.snapshot.title,
      upserts: outcome.accepted,
      deletedIds: outcome.deletedIds,
      conflicts: [],
    }
  }
  if (outcome._tag === 'Conflict') {
    return {
      status: 'conflict',
      revision: outcome.snapshot.revision,
      title: outcome.snapshot.title,
      upserts: outcome.accepted,
      deletedIds: outcome.deletedIds,
      conflicts: outcome.conflicts,
    }
  }
  return {
    status: 'unchanged',
    revision: outcome.snapshot.revision,
    title: outcome.snapshot.title,
    upserts: [],
    deletedIds: [],
    conflicts: [],
  }
}

/**
 * Maps the upstream gadget-shaped client protocol onto Garden's Effect HttpApi
 * GET/POST/SSE surface. The first subscription reuses the loader snapshot;
 * iframe reloads fetch fresh authority before opening another event stream.
 */
export class WorkspaceDocsAdapter {
  readonly #dependencies: WorkspaceDocsAdapterDependencies
  readonly #documentId: string
  #initialSnapshot: DocumentSnapshot | undefined
  #unsubscribe: (() => void) | undefined

  constructor(args: {
    dependencies?: WorkspaceDocsAdapterDependencies
    documentId: string
    initialSnapshot?: DocumentSnapshot
  }) {
    this.#dependencies = args.dependencies ?? defaultDependencies
    this.#documentId = args.documentId
    this.#initialSnapshot = args.initialSnapshot
  }

  /** Applies an upstream operation after adding Garden's idempotency key. */
  async applyOperation(
    operation: WorkspaceDocsOperation,
  ): Promise<WorkspaceDocsOperationResult> {
    const outcome = await this.#dependencies.applyOperation({
      documentId: this.#documentId,
      operation: {
        ...operation,
        operationId: operation.operationId ?? crypto.randomUUID(),
      },
    })
    return toWorkspaceDocsOperationResult(outcome)
  }

  /**
   * Starts one live subscription and returns the baseline expected by upstream.
   * Calling this again models an iframe reload and replaces the old stream.
   */
  async subscribe(
    push: (event: WorkspaceDocsEvent) => void,
  ): Promise<DocumentSnapshot> {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    const snapshot =
      this.#initialSnapshot ??
      (await this.#dependencies.getSnapshot(this.#documentId))
    this.#initialSnapshot = undefined
    this.#unsubscribe = this.#dependencies.subscribe({
      documentId: this.#documentId,
      onEvent: (event) => push(toWorkspaceDocsEvent(event)),
    })
    return snapshot
  }

  /** Releases the current SSE subscription when the iframe leaves the tree. */
  dispose() {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
  }
}
