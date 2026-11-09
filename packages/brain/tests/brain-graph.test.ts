import type { QueryRequest } from '@helix-db/helix-db'
import { DateTime, Effect } from 'effect'
import { expect, it } from '@effect/vitest'
import { EDGES } from '../src/helix/constants.ts'
import { ItemId, Kind, WorkspaceId } from '../src/domain/items.ts'
import { makeBrain } from '../src/services/Brain.ts'
import { Chunker } from '../src/services/Chunker.ts'
import { Embeddings } from '../src/services/Embeddings.ts'
import { Extractor } from '../src/services/ExtractorService.ts'
import {
  HelixClient,
  type QueryResponse,
  type RunOptions,
} from '../src/services/HelixClient.ts'
import { RawFileStore } from '../src/services/RawFileStore.ts'

const tenantId = WorkspaceId.make('ws-graph')
const storedOrigin = JSON.stringify({
  actor: { _tag: 'Human', userId: 'test-user' },
  at: '2026-01-01T00:00:00.000Z',
})

const itemRow = (id: number, label: string, kind = 'decision') => ({
  $id: id,
  workspace_id: tenantId,
  kind,
  label,
  indexed: false,
  origin: storedOrigin,
})

type HelixCall = {
  readonly request: QueryRequest
  readonly options?: RunOptions
}

/**
 * Builds the real Brain implementation over a deterministic Helix adapter.
 * Before these tests, graph methods had no isolated seam; responses can now be
 * scripted while assertions inspect the exact pinned-SDK request AST.
 */
const testBrain = (
  respond: (request: QueryRequest) => QueryResponse,
  calls: HelixCall[],
) =>
  makeBrain.pipe(
    Effect.provideService(
      HelixClient,
      HelixClient.of({
        run: (request, options) => {
          calls.push({
            request,
            ...(options === undefined ? {} : { options }),
          })
          return Effect.succeed(respond(request))
        },
      }),
    ),
    Effect.provideService(
      Embeddings,
      Embeddings.of({ dim: 384, embed: () => Effect.succeed([]) }),
    ),
    Effect.provideService(
      Chunker,
      Chunker.of({ chunk: () => Effect.succeed([]) }),
    ),
    Effect.provideService(
      Extractor,
      Extractor.of({
        extract: () => Effect.die('unused extractor'),
        extractFromBytes: () => Effect.die('unused extractor'),
      }),
    ),
    Effect.provideService(
      RawFileStore,
      RawFileStore.of({ read: () => Effect.die('unused file store') }),
    ),
  )

it.effect('records an append-only mention observation on its source edge', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const brain = yield* testBrain(
      () => ({
        source: [itemRow(1, 'Source')],
        recorded: [itemRow(1, 'Source')],
      }),
      calls,
    )
    const observation = yield* brain.observeMention({
      tenantId,
      itemId: ItemId.make('1'),
      span: { start: 12, end: 18 },
      text: 'Garden',
      actor: { _tag: 'Agent', agentId: 'agent-1', runId: 'run-1' },
    })

    expect(observation.text).toBe('Garden')
    expect(observation.span).toEqual({ start: 12, end: 18 })
    expect(observation.origin.fromItem).toBe(ItemId.make('1'))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.options?.awaitDurability).toBe(true)
    const request = calls[0]?.request.toJsonString() ?? ''
    expect(request).toContain('"query_name":"brain.observe_mention"')
    expect(request).toContain('"add_e"')
    expect(request).toContain('"label":"MENTIONS"')
    expect(request).toContain('"mention_text"')
    expect(request).not.toContain('"add_n"')
  }),
)

it.effect(
  'updates audit metadata without invalidating indexed source content',
  () =>
    Effect.gen(function* () {
      const calls: HelixCall[] = []
      const indexedRow = {
        ...itemRow(1, 'Partner brief', 'partner-brief'),
        summary: 'Acme partnership plan and named owners.',
        indexed: true,
        body: 'Acme and Alice will launch the Atlas project.',
      }
      const brain = yield* testBrain(
        (request) =>
          request.toJsonString().includes('brain.update_item_metadata')
            ? { updated: [indexedRow] }
            : { item: [indexedRow] },
        calls,
      )

      const updated = yield* brain.updateItemMetadata({
        tenantId,
        itemId: ItemId.make('1'),
        kind: Kind.make('partner-brief'),
        summary: 'Acme partnership plan and named owners.',
      })

      expect(updated.kind).toBe(Kind.make('partner-brief'))
      expect(updated.summary).toBe('Acme partnership plan and named owners.')
      expect(updated.indexed).toBe(true)
      expect(updated.body).toBe('Acme and Alice will launch the Atlas project.')
      expect(calls).toHaveLength(2)
      expect(calls[0]?.options?.awaitDurability).toBe(true)
      const request = calls[0]?.request.toJsonString() ?? ''
      expect(request).toContain('"query_name":"brain.update_item_metadata"')
      expect(request).toContain('"name":"kind"')
      expect(request).toContain('"name":"summary"')
      expect(request).not.toContain('"name":"indexed"')
      expect(request).not.toContain('"name":"body"')
      expect(request).not.toContain('"name":"embedding"')
    }),
)

it.effect('records a terminal file indexing failure', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const failedRow = {
      ...itemRow(1, 'Quarterly report', 'file'),
      index_status: 'failed',
      index_error: 'planner failed',
    }
    const brain = yield* testBrain(
      (request) =>
        request.toJsonString().includes('brain.update_index_status')
          ? { updated: [failedRow] }
          : { item: [failedRow] },
      calls,
    )

    const updated = yield* brain.updateIndexStatus({
      tenantId,
      itemId: ItemId.make('1'),
      status: 'failed',
      error: 'planner failed',
    })

    expect(updated.indexed).toBe(false)
    expect(updated.indexStatus).toBe('failed')
    expect(updated.indexError).toBe('planner failed')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.options?.awaitDurability).toBe(true)

    const request = calls[0]?.request.toJsonString() ?? ''
    expect(request).toContain('"query_name":"brain.update_index_status"')
    expect(request).toContain('"name":"index_status"')
    expect(request).toContain('"string":"failed"')
    expect(request).toContain('"name":"index_error"')
    expect(request).toContain('"string":"planner failed"')
    expect(request).toContain('"name":"indexed"')
    expect(request).toContain('"bool":false')
  }),
)

it.effect('deletes a workspace file and its derived sections', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const fileRow = {
      ...itemRow(1, 'Quarterly report', 'file'),
      r2_key: 'brain/workspaces/ws-graph/quarterly-report.pdf',
    }
    const brain = yield* testBrain(
      (request) =>
        request.toJsonString().includes('brain.delete_file')
          ? { sections: [], file: [fileRow] }
          : { file: [fileRow] },
      calls,
    )

    const deleted = yield* brain.deleteFile(ItemId.make('1'), tenantId)

    expect(deleted?.id).toBe(ItemId.make('1'))
    expect(deleted?.r2Key).toBe(
      'brain/workspaces/ws-graph/quarterly-report.pdf',
    )
    expect(calls).toHaveLength(3)

    const readRequest = calls[0]?.request.toJsonString() ?? ''
    expect(readRequest).toContain('"query_name":"brain.read"')
    expect(readRequest).toContain('"property":"$label"')
    expect(readRequest).toContain('"string":"file"')
    expect(readRequest).toContain('"property":"workspace_id"')
    expect(readRequest).toContain('"string":"ws-graph"')

    const sectionsRequest = calls[1]?.request.toJsonString() ?? ''
    expect(calls[1]?.options?.awaitDurability).toBe(true)
    expect(sectionsRequest).toContain('"query_name":"brain.delete_file"')
    expect(sectionsRequest).toContain('"label":"HAS_SECTION"')
    expect(sectionsRequest).toContain('"drop"')
    expect(sectionsRequest).toContain('"property":"workspace_id"')
    expect(sectionsRequest).toContain('"string":"ws-graph"')

    const fileRequest = calls[2]?.request.toJsonString() ?? ''
    expect(calls[2]?.options?.awaitDurability).toBe(true)
    expect(fileRequest).toContain('"query_name":"brain.delete_file"')
    expect(fileRequest).toContain('"property":"$label"')
    expect(fileRequest).toContain('"string":"file"')
    expect(fileRequest).toContain('"drop"')
    expect(fileRequest).not.toContain('"label":"HAS_SECTION"')
  }),
)

it.effect(
  'links existing items with fixed and agent-invented edge labels',
  () =>
    Effect.gen(function* () {
      const calls: HelixCall[] = []
      const brain = yield* testBrain(
        () => ({
          from: [itemRow(1, 'From')],
          to: [itemRow(2, 'To')],
          created: [itemRow(1, 'From')],
        }),
        calls,
      )
      const labels = [
        EDGES.hasSection,
        EDGES.mentions,
        EDGES.sameAs,
        'CONTRADICTS',
      ]

      for (const edge of labels) {
        const linked = yield* brain.linkItems({
          tenantId,
          from: ItemId.make('1'),
          to: ItemId.make('2'),
          edge,
          actor: { _tag: 'Agent', agentId: 'agent-1', runId: 'run-1' },
        })
        expect(linked).toEqual({
          from: ItemId.make('1'),
          to: ItemId.make('2'),
          edge,
          created: true,
        })
      }

      expect(calls).toHaveLength(labels.length)
      labels.forEach((edge, index) => {
        const request = calls[index]?.request.toJsonString() ?? ''
        expect(request).toContain('"query_name":"brain.link_items"')
        expect(request).toContain(`"label":"${edge}"`)
        expect(request).toContain('"without"')
      })
    }),
)

it.effect(
  'returns a deduplicated bounded two-hop neighborhood with mentions',
  () =>
    Effect.gen(function* () {
      const calls: HelixCall[] = []
      const brain = yield* testBrain(
        () => ({
          root_item: [itemRow(1, 'Root')],
          hop_1_items: [
            itemRow(2, 'Policy', 'policy'),
            itemRow(2, 'Policy', 'policy'),
          ],
          hop_2_items: [itemRow(3, 'Person', 'person')],
          hop_1_edges: [
            {
              id: 90,
              from: 1,
              to: 1,
              edge: EDGES.mentions,
              workspace_id: tenantId,
              origin: storedOrigin,
              mention_text: 'Alice',
              mention_span_start: 5,
              mention_span_end: 10,
            },
            {
              id: 91,
              from: 1,
              to: 2,
              edge: EDGES.sameAs,
              workspace_id: tenantId,
              origin: storedOrigin,
            },
            {
              id: 91,
              from: 1,
              to: 2,
              edge: EDGES.sameAs,
              workspace_id: tenantId,
              origin: storedOrigin,
            },
          ],
          hop_2_edges: [
            {
              id: 92,
              from: 2,
              to: 3,
              edge: EDGES.hasSection,
              workspace_id: tenantId,
            },
          ],
        }),
        calls,
      )

      const result = yield* brain.neighborhood({
        tenantId,
        itemId: ItemId.make('1'),
        depth: 2,
      })

      expect(result.items.map((item) => item.id)).toEqual([
        ItemId.make('1'),
        ItemId.make('2'),
        ItemId.make('3'),
      ])
      expect(result.edges.map((edge) => edge.edge)).toEqual([
        EDGES.mentions,
        EDGES.sameAs,
        EDGES.hasSection,
      ])
      expect(result.edges[0]?.mention).toMatchObject({
        itemId: ItemId.make('1'),
        text: 'Alice',
        span: { start: 5, end: 10 },
      })
      const request = calls[0]?.request.toJsonString() ?? ''
      expect(request).toContain('"query_name":"brain.neighborhood"')
      expect(request).toContain('"name":"hop_2"')
      expect(request).toContain('"both_e"')
      expect(request).toContain('"literal":50')
      expect(request).toContain('"literal":100')
      expect(request).not.toContain('"repeat"')
    }),
)

it.effect('lists a bounded file set without leaking another workspace', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const otherTenantId = WorkspaceId.make('ws-other')

    const brain = yield* testBrain(
      () => ({
        files: [
          itemRow(1, 'Alpha.txt', 'file'),
          {
            ...itemRow(2, 'Private.txt', 'file'),
            workspace_id: otherTenantId,
          },
          itemRow(3, 'Release notes.md', 'file'),
        ],
      }),
      calls,
    )

    const files = yield* brain.listFiles({
      tenantId,
      limit: 25,
    })

    expect(files.map((file) => file.label)).toEqual([
      'Alpha.txt',
      'Release notes.md',
    ])

    expect(calls).toHaveLength(1)

    const request = calls[0]?.request.toJsonString() ?? ''

    expect(request).toContain('"query_name":"brain.list_files"')
    expect(request).toContain('"property":"$label"')
    expect(request).toContain('"string":"file"')
    expect(request).toContain('"workspace_id"')
    expect(request).toContain('"limit"')
  }),
)

it.effect('scopes direct reads in the Helix traversal', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const brain = yield* testBrain(
      () => ({ item: [itemRow(1, 'Note')] }),
      calls,
    )

    const item = yield* brain.read(ItemId.make('1'), tenantId)

    expect(item?.id).toBe(ItemId.make('1'))
    const request = calls[0]?.request.toJsonString() ?? ''
    expect(request).toContain('"property":"workspace_id"')
    expect(request).toContain('"string":"ws-graph"')
  }),
)

it.effect('waits for durable item creation before returning', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    let responseIndex = 0
    const brain = yield* testBrain(
      () =>
        responseIndex++ === 0
          ? { created: [itemRow(1, 'Durable note')] }
          : { item: [itemRow(1, 'Durable note')] },
      calls,
    )

    yield* brain.addItem({
      tenantId,
      kind: Kind.make('note'),
      label: 'Durable note',
      origin: {
        actor: { _tag: 'Human', userId: 'test-user' },
        at: DateTime.makeUnsafe(new Date('2026-01-01T00:00:00.000Z')),
      },
    })

    expect(calls[0]?.options?.awaitDurability).toBe(true)
  }),
)

it.effect('fails malformed stored mention spans in the error channel', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const brain = yield* testBrain(
      () => ({
        root_item: [itemRow(1, 'Root')],
        hop_1_items: [],
        hop_1_edges: [
          {
            id: 90,
            from: 1,
            to: 1,
            edge: EDGES.mentions,
            workspace_id: tenantId,
            origin: storedOrigin,
            mention_text: 'Alice',
            mention_span_start: 10,
            mention_span_end: 5,
          },
        ],
      }),
      calls,
    )

    const exit = yield* Effect.exit(
      brain.neighborhood({ tenantId, itemId: ItemId.make('1') }),
    )

    expect(exit._tag).toBe('Failure')
  }),
)

it.effect('fails when the embedding service omits a requested vector', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const brain = yield* testBrain(() => ({}), calls)

    const exit = yield* Effect.exit(
      brain.addText({
        tenantId,
        label: 'Missing vector',
        body: 'Body',
        actor: { _tag: 'Human', userId: 'test-user' },
      }),
    )

    expect(exit._tag).toBe('Failure')
    expect(calls).toHaveLength(0)
  }),
)

it.effect('hides scoped files from viewers who cannot see them', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const brain = yield* testBrain(
      () => ({
        files: [
          itemRow(1, 'Org.txt', 'file'),
          {
            ...itemRow(2, 'Mine.txt', 'file'),
            scope_kind: 'user',
            scope_id: 'u1',
          },
          {
            ...itemRow(3, 'Team.txt', 'file'),
            scope_kind: 'team',
            scope_id: 't1',
          },
        ],
      }),
      calls,
    )

    const owner = yield* brain.listFiles({
      tenantId,
      viewer: { teamIds: new Set(['t1']), userId: 'u1' },
    })
    expect(owner.map((file) => file.label)).toEqual([
      'Org.txt',
      'Mine.txt',
      'Team.txt',
    ])

    const stranger = yield* brain.listFiles({
      tenantId,
      viewer: { teamIds: new Set(), userId: 'u2' },
    })
    expect(stranger.map((file) => file.label)).toEqual(['Org.txt'])

    const anonymous = yield* brain.listFiles({ tenantId })
    expect(anonymous.map((file) => file.label)).toEqual(['Org.txt'])
  }),
)

it.effect('hides a scoped item from a viewer who cannot see it', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const row = {
      ...itemRow(1, 'Mine'),
      scope_kind: 'user',
      scope_id: 'u1',
    }
    const brain = yield* testBrain(() => ({ item: [row] }), calls)

    const owner = yield* brain.read(ItemId.make('1'), tenantId, {
      teamIds: new Set(),
      userId: 'u1',
    })
    expect(owner?.label).toBe('Mine')

    const stranger = yield* brain.read(ItemId.make('1'), tenantId, {
      teamIds: new Set(),
      userId: 'u2',
    })
    expect(stranger).toBeNull()
  }),
)

it.effect('hides a scoped file from a viewer who cannot see it', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const row = {
      ...itemRow(1, 'Secret.txt', 'file'),
      scope_kind: 'user',
      scope_id: 'u1',
    }
    const brain = yield* testBrain(() => ({ file: [row] }), calls)

    const owner = yield* brain.readFileItem(ItemId.make('1'), tenantId, {
      teamIds: new Set(),
      userId: 'u1',
    })
    expect(owner?.label).toBe('Secret.txt')

    const stranger = yield* brain.readFileItem(ItemId.make('1'), tenantId, {
      teamIds: new Set(),
      userId: 'u2',
    })
    expect(stranger).toBeNull()
  }),
)

it.effect('decodes an occurred_at timestamp from a stored row', () =>
  Effect.gen(function* () {
    const calls: HelixCall[] = []
    const row = {
      ...itemRow(1, 'Dated note'),
      occurred_at: '2026-03-01T00:00:00.000Z',
    }
    const brain = yield* testBrain(() => ({ item: [row] }), calls)

    const item = yield* brain.read(ItemId.make('1'), tenantId)
    expect(item?.occurredAt).toBeDefined()
    expect(item?.occurredAt?.pipe(String)).toContain('2026-03-01')
  }),
)
