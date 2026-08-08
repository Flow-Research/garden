/*
 * Adapted from Cloudflare OS Workspace Docs `server.js`.
 *
 * Upstream repository: https://github.com/cloudflare/cloudflare-os
 * Repository commit: e1ab8fbd4f609aff7ede9d490bafe1bcf9b2a682
 * Gadget source commit: f0517773aa6a2f6fbb1281ddbadcca3cb6fd2992
 * Extracted source: ./server.js
 * License: Apache-2.0 (../LICENSE)
 *
 * Garden changes are intentionally mechanical: Durable Object I/O, the
 * mutation queue, subscribers, and Date.now() stay in Garden's existing
 * per-thread authority. These functions receive the current document and
 * timestamp, then return the next document beside the original upstream RPC
 * result. The setDocument/applyOperation algorithms below otherwise retain the
 * upstream control flow, block sanitization, version checks, and ordering.
 */

export const DEFAULT_TITLE = 'Untitled document'

export interface WorkspaceDocsBlock {
  readonly id: string
  readonly html: string
  readonly version: number
}

export interface WorkspaceDocsBlockInput {
  readonly id: string
  readonly html: string
  readonly baseVersion?: number
}

export interface WorkspaceDocsDeletion {
  readonly id: string
  readonly baseVersion: number
}

export interface WorkspaceDocsDocument {
  readonly revision: number
  readonly title: string
  readonly blocks: ReadonlyArray<WorkspaceDocsBlock>
  readonly lastModified: number
}

export interface WorkspaceDocsSetDocument {
  readonly blocks: ReadonlyArray<WorkspaceDocsBlockInput>
  readonly title: string
}

export interface WorkspaceDocsOperation {
  readonly senderId: string
  readonly upserts: ReadonlyArray<WorkspaceDocsBlockInput>
  readonly deletes: ReadonlyArray<WorkspaceDocsDeletion>
  readonly order: ReadonlyArray<string>
  readonly title?: string
}

export type WorkspaceDocsUnchangedResult = {
  readonly status: 'conflict' | 'unchanged'
  readonly revision: number
  readonly conflicts: ReadonlyArray<WorkspaceDocsBlock>
}

export type WorkspaceDocsChangedResult = {
  readonly status: 'applied' | 'conflict'
  readonly type: 'operation'
  readonly senderId: string
  readonly revision: number
  readonly title: string
  readonly upserts: ReadonlyArray<WorkspaceDocsBlock>
  readonly deletedIds: ReadonlyArray<string>
  readonly order: ReadonlyArray<string>
  readonly lastModified: number
  readonly conflicts: ReadonlyArray<WorkspaceDocsBlock>
}

export type WorkspaceDocsOperationResult =
  | WorkspaceDocsUnchangedResult
  | WorkspaceDocsChangedResult

export interface WorkspaceDocsTransition {
  readonly document: WorkspaceDocsDocument
  readonly result: WorkspaceDocsOperationResult
}

/** Exact upstream block normalization, typed after Garden's boundary decode. */
export function sanitizeBlocks(
  blocks: ReadonlyArray<WorkspaceDocsBlockInput> | undefined,
) {
  if (!Array.isArray(blocks)) return []
  const result: WorkspaceDocsBlockInput[] = []
  const seen = new Set<string>()
  for (const value of blocks) {
    const id = String(value?.id || '').slice(0, 100)
    const html = String(value?.html || '')
    if (!id || seen.has(id) || html.length > 10_000_000) continue
    seen.add(id)
    result.push({
      id,
      html,
      baseVersion: Number(value?.baseVersion || 0),
    })
  }
  return result
}

/**
 * Source-derived `setDocumentLocked`: full writers always replace canonical
 * content while retaining per-block version history for stable block ids.
 */
export function setDocument(
  previous: WorkspaceDocsDocument | undefined,
  args: WorkspaceDocsSetDocument,
  now: number,
): WorkspaceDocsDocument {
  const previousById = new Map(
    (previous?.blocks || []).map((block) => [block.id, block]),
  )
  const cleanBlocks = sanitizeBlocks(args.blocks)
  return {
    revision: (previous?.revision || 0) + 1,
    title: String(args.title || DEFAULT_TITLE),
    blocks: cleanBlocks.map((block) => ({
      id: block.id,
      html: block.html,
      version: (previousById.get(block.id)?.version || 0) + 1,
    })),
    lastModified: now,
  }
}

/**
 * Source-derived `applyOperationLocked`. Garden supplies serialization and
 * persistence; this retains upstream partial commits and last-writer ordering.
 */
export function applyOperation(
  document: WorkspaceDocsDocument,
  operation: WorkspaceDocsOperation,
  now: number,
): WorkspaceDocsTransition {
  const byId = new Map(document.blocks.map((block) => [block.id, block]))
  const accepted: WorkspaceDocsBlock[] = []
  const conflicts: WorkspaceDocsBlock[] = []

  for (const incoming of sanitizeBlocks(operation.upserts || [])) {
    const current = byId.get(incoming.id)
    const expected = Number(incoming.baseVersion || 0)
    if (current && expected !== current.version) {
      conflicts.push(current)
      continue
    }
    if (!current && expected !== 0) continue
    const next = {
      id: incoming.id,
      html: incoming.html,
      version: (current?.version || 0) + 1,
    }
    byId.set(next.id, next)
    accepted.push(next)
  }

  const deletedIds: string[] = []
  for (const deletion of operation.deletes || []) {
    const id = String(deletion?.id || '')
    const current = byId.get(id)
    if (!current) continue
    if (Number(deletion.baseVersion || 0) !== current.version) {
      conflicts.push(current)
      continue
    }
    byId.delete(id)
    deletedIds.push(id)
  }

  // Ordering is intentionally last-writer-wins. Text/content remains guarded
  // by per-block versions, while inserts, moves and list restructuring stay
  // responsive and deterministic.
  const requestedOrder = Array.isArray(operation.order)
    ? operation.order.map(String)
    : []
  const order: string[] = []
  const seen = new Set<string>()
  for (const id of requestedOrder) {
    if (byId.has(id) && !seen.has(id)) {
      order.push(id)
      seen.add(id)
    }
  }
  for (const block of document.blocks) {
    if (byId.has(block.id) && !seen.has(block.id)) {
      order.push(block.id)
      seen.add(block.id)
    }
  }
  for (const id of byId.keys()) {
    if (!seen.has(id)) order.push(id)
  }

  const titleChanged =
    typeof operation.title === 'string' && operation.title !== document.title
  const changed = Boolean(
    accepted.length ||
    deletedIds.length ||
    titleChanged ||
    order.join('\n') !== document.blocks.map((block) => block.id).join('\n'),
  )

  if (!changed) {
    return {
      document,
      result: {
        status: conflicts.length ? 'conflict' : 'unchanged',
        revision: document.revision,
        conflicts,
      },
    }
  }

  const blocks: WorkspaceDocsBlock[] = []
  for (const id of order) {
    const block = byId.get(id)
    if (block) blocks.push(block)
  }
  const nextDocument = {
    revision: document.revision + 1,
    title:
      typeof operation.title === 'string' ? operation.title : document.title,
    blocks,
    lastModified: now,
  }

  const event = {
    type: 'operation' as const,
    senderId: operation.senderId,
    revision: nextDocument.revision,
    title: nextDocument.title,
    upserts: accepted,
    deletedIds,
    order,
    lastModified: nextDocument.lastModified,
  }
  return {
    document: nextDocument,
    result: {
      status: conflicts.length ? 'conflict' : 'applied',
      ...event,
      conflicts,
    },
  }
}
