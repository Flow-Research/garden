import {
  Array as EffectArray,
  Context,
  DateTime,
  Effect,
  Option,
  Schema,
} from 'effect'
import {
  BatchCondition,
  IndexSpec,
  NodeRef,
  Predicate,
  Projection,
  PropertyProjection,
  PropertyValue,
  SourcePredicate,
  VectorDistanceMetric,
  g,
  readBatch,
  writeBatch,
  Order,
} from '@helix-db/helix-db'
import type { PropertyValueInput, Traversal } from '@helix-db/helix-db'
import {
  Actor,
  BrainEdge,
  BrainItem,
  BrainNeighborhood,
  BrainIndexStatus,
  ItemId,
  Kind,
  MentionObservation,
  MentionSpan,
  NewBrainItem,
  Origin,
  scopeOf,
  WorkspaceId,
} from '../domain/items.ts'
import type { SearchHit } from '../domain/items.ts'
import {
  canViewScope,
  orgScope,
  teamScope,
  userScope,
  type BrainScope,
  type ScopeViewer,
} from '../domain/scope.ts'
import {
  EmbedError,
  ExtractError,
  HelixError,
  WriteConflict,
} from '../errors.ts'
import {
  EDGES,
  LABELS,
  MENTION_PROPS,
  PROPS,
  QUERY,
  SOURCE_KEY_PROP,
  VECTOR_PROP,
} from '../helix/constants.ts'
import { EMBEDDING_DIM, Embeddings } from './Embeddings.ts'
import type { EmbeddingsShape } from './Embeddings.ts'
import { HelixClient } from './HelixClient.ts'
import type { HelixClientShape } from './HelixClient.ts'
import { rerankByFreshness } from './freshness.ts'
import { Chunker } from './Chunker.ts'
import { Extractor } from './ExtractorService.ts'
import { RawFileStore } from './RawFileStore.ts'

export type BrainShape = {
  readonly ensureIndexes: () => Effect.Effect<void, HelixError | WriteConflict>
  readonly addItem: (
    input: NewBrainItem,
  ) => Effect.Effect<BrainItem, HelixError | WriteConflict>
  readonly addText: (input: {
    tenantId: WorkspaceId
    label: string
    body: string
    kind?: Kind
    summary?: string
    scope?: BrainScope
    actor: Actor
  }) => Effect.Effect<BrainItem, HelixError | WriteConflict | EmbedError>

  readonly updateIndexStatus: (input: {
    itemId: ItemId
    tenantId: WorkspaceId
    status: BrainIndexStatus
    error?: string
  }) => Effect.Effect<BrainItem, HelixError | WriteConflict>
  readonly deleteFile: (
    itemId: ItemId,
    tenantId: WorkspaceId,
  ) => Effect.Effect<BrainItem | null, HelixError | WriteConflict>
  /**
   * Updates agent-authored structure without changing source content. Static
   * ingestion previously had no way to replace the mechanical `file` kind and
   * extracted title summary; metadata-only updates now preserve embeddings,
   * sections, body, storage label, and indexed state.
   */
  readonly updateItemMetadata: (input: {
    tenantId: WorkspaceId
    itemId: ItemId
    kind: Kind
    summary: string
  }) => Effect.Effect<BrainItem, HelixError | WriteConflict>
  readonly index: (
    itemId: ItemId,
    tenantId: WorkspaceId,
  ) => Effect.Effect<
    BrainItem,
    HelixError | WriteConflict | EmbedError | ExtractError
  >
  readonly read: (
    id: ItemId,
    tenantId: WorkspaceId,
    viewer?: ScopeViewer,
  ) => Effect.Effect<BrainItem | null, HelixError | WriteConflict>
  /**
   * Reads only a file storage node inside the specified workspace.
   */
  readonly readFileItem: (
    id: ItemId,
    tenantId: WorkspaceId,
    viewer?: ScopeViewer,
  ) => Effect.Effect<BrainItem | null, HelixError | WriteConflict>
  readonly search: (input: {
    tenantId: WorkspaceId
    query: string
    k: number
    viewer?: ScopeViewer
  }) => Effect.Effect<
    readonly SearchHit[],
    HelixError | WriteConflict | EmbedError
  >
  readonly listFiles: (input: {
    tenantId: WorkspaceId
    limit?: number
    viewer?: ScopeViewer
  }) => Effect.Effect<readonly BrainItem[], HelixError | WriteConflict>
  readonly linkSections: (
    fileId: ItemId,
    sectionIds: readonly ItemId[],
    tenantId: WorkspaceId,
  ) => Effect.Effect<void, HelixError | WriteConflict>
  readonly sectionsOf: (
    fileId: ItemId,
    tenantId: WorkspaceId,
    viewer?: ScopeViewer,
  ) => Effect.Effect<readonly BrainItem[], HelixError | WriteConflict>
  /**
   * Appends the exact mention text observed in one source item. It deliberately
   * performs no entity resolution or creation so later passes can reinterpret
   * the corpus without re-reading source content.
   */
  readonly observeMention: (input: {
    tenantId: WorkspaceId
    itemId: ItemId
    span?: MentionSpan
    text: string
    actor: Actor
  }) => Effect.Effect<MentionObservation, HelixError | WriteConflict>
  /**
   * Links two existing tenant items with a caller-chosen edge label. `SAME_AS`
   * is always a soft assertion: automatic merging is forbidden, and any later
   * promotion must update canonical anchors rather than collapsing nodes.
   */
  readonly linkItems: (input: {
    tenantId: WorkspaceId
    from: ItemId
    to: ItemId
    edge: string
    actor: Actor
  }) => Effect.Effect<
    {
      readonly from: ItemId
      readonly to: ItemId
      readonly edge: string
      readonly created: boolean
    },
    HelixError | WriteConflict
  >
  /**
   * Reads a fixed one- or two-hop item neighborhood. Depth is rejected outside
   * that range, and both query streams and decoded output have hard limits.
   */
  readonly neighborhood: (input: {
    tenantId: WorkspaceId
    itemId: ItemId
    depth?: number
    viewer?: ScopeViewer
  }) => Effect.Effect<BrainNeighborhood, HelixError | WriteConflict>
  readonly readFile: (
    itemId: ItemId,
    tenantId: WorkspaceId,
    range?: { readonly start: number; readonly end: number },
    viewer?: ScopeViewer,
  ) => Effect.Effect<Uint8Array, HelixError | WriteConflict>
}

export class Brain extends Context.Service<Brain, BrainShape>()(
  '@garden/brain/Brain',
) {}

const OriginJsonCodec = Schema.toCodecJson(Origin)
const OriginFromJsonString = Schema.fromJsonString(OriginJsonCodec)

const ItemRow = Schema.Struct({
  $id: Schema.optional(Schema.Number),
  id: Schema.optional(Schema.Number),
  workspace_id: Schema.String,
  kind: Schema.String,
  label: Schema.String,
  summary: Schema.optional(Schema.String),
  r2_key: Schema.optional(Schema.String),
  size_bytes: Schema.optional(Schema.Number),
  canonical_type: Schema.optional(Schema.String),
  canonical_value: Schema.optional(Schema.String),
  indexed: Schema.optional(Schema.Boolean),
  index_status: Schema.optional(BrainIndexStatus),
  index_error: Schema.optional(Schema.String),
  origin: Schema.String,
  body: Schema.optional(Schema.String),
  scope_kind: Schema.optional(Schema.String),
  scope_id: Schema.optional(Schema.String),
  occurred_at: Schema.optional(Schema.String),
})

const EdgeRow = Schema.Struct({
  id: Schema.Unknown,
  from: Schema.Unknown,
  to: Schema.Unknown,
  edge: Schema.String,
  workspace_id: Schema.String,
  origin: Schema.optional(Schema.String),
  mention_text: Schema.optional(Schema.String),
  mention_span_start: Schema.optional(Schema.Number),
  mention_span_end: Schema.optional(Schema.Number),
})

type Row = Record<string, unknown>

const toRows = (value: unknown): readonly Row[] => {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is Row => typeof row === 'object' && row !== null,
    )
  }
  return typeof value === 'object' && value !== null ? [value as Row] : []
}

const firstRow = (
  result: Record<string, unknown>,
  name: string,
): Row | undefined => toRows(result[name])[0]

const rows = (result: Record<string, unknown>, name: string): readonly Row[] =>
  toRows(result[name])

const nodeId = (itemId: ItemId): number => Number(itemId)

const decodeItemId = (row: Row): Effect.Effect<ItemId, HelixError> => {
  const raw = row.$id ?? row.id
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return Effect.fail(new HelixError({ message: 'item row is missing an id' }))
  }
  return Effect.succeed(ItemId.make(String(raw)))
}

const decodeItemOrigin = (raw: unknown): Effect.Effect<Origin, HelixError> =>
  Schema.decodeUnknownEffect(OriginFromJsonString)(raw).pipe(
    Effect.mapError(
      (cause) =>
        new HelixError({ message: 'invalid brain item origin', cause }),
    ),
  )

const originJson = (origin: Origin): string =>
  JSON.stringify(
    Schema.encodeSync(
      OriginJsonCodec as unknown as Schema.Encoder<Schema.Json>,
    )(Schema.decodeUnknownSync(Origin)(origin)),
  )

const decodeScope = (
  kind: unknown,
  id: unknown,
): Effect.Effect<BrainScope, HelixError> => {
  if (kind === undefined || kind === null || kind === '' || kind === 'org') {
    return Effect.succeed(orgScope())
  }
  if (kind === 'team' && typeof id === 'string' && id !== '') {
    return Effect.succeed(teamScope(id))
  }
  if (kind === 'user' && typeof id === 'string' && id !== '') {
    return Effect.succeed(userScope(id))
  }
  return Effect.fail(new HelixError({ message: 'invalid brain item scope' }))
}

const decodeRow = (row: Row): Effect.Effect<BrainItem, HelixError> =>
  Effect.gen(function* () {
    const item = yield* Schema.decodeUnknownEffect(ItemRow)(row).pipe(
      Effect.mapError(
        (cause) => new HelixError({ message: 'invalid brain item row', cause }),
      ),
    )
    const id = yield* decodeItemId(row)
    const origin = yield* decodeItemOrigin(item.origin)
    const scope = yield* decodeScope(item.scope_kind, item.scope_id)
    const occurredAt =
      item.occurred_at === undefined
        ? undefined
        : Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.DateTimeUtcFromString)(
              item.occurred_at,
            ),
          )

    return {
      id,
      tenantId: WorkspaceId.make(item.workspace_id),
      kind: Kind.make(item.kind),
      label: item.label,
      summary: item.summary,
      r2Key: item.r2_key,
      sizeBytes: item.size_bytes,
      canonical:
        item.canonical_type === undefined || item.canonical_value === undefined
          ? undefined
          : { type: item.canonical_type, value: item.canonical_value },
      indexed: item.indexed ?? false,
      indexStatus: item.index_status,
      indexError:
        item.index_error === undefined || item.index_error === ''
          ? undefined
          : item.index_error,
      origin,
      body: item.body,
      scope,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    }
  })

const noViewer: ScopeViewer = { teamIds: new Set(), userId: undefined }

const visibleTo = (item: BrainItem, viewer: ScopeViewer): boolean =>
  canViewScope(scopeOf(item), viewer)

const storedId = (
  value: unknown,
  field: string,
): Effect.Effect<string, HelixError> => {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return Effect.succeed(String(value))
  }
  return Effect.fail(
    new HelixError({ message: `graph edge row is missing ${field}` }),
  )
}

const decodeStoredOrigin = (raw: string): Effect.Effect<Origin, HelixError> =>
  Schema.decodeUnknownEffect(OriginFromJsonString)(raw).pipe(
    Effect.mapError(
      (cause) =>
        new HelixError({ message: 'invalid graph edge origin', cause }),
    ),
  )

/**
 * Decodes one projected edge and recovers mention observations from edge
 * properties. Previously graph edges had no service-facing representation;
 * malformed persisted observation spans now fail instead of being guessed.
 */
const rowToBrainEdge = (raw: Row): Effect.Effect<BrainEdge, HelixError> =>
  Effect.gen(function* () {
    const row = yield* Schema.decodeUnknownEffect(EdgeRow)(raw).pipe(
      Effect.mapError(
        (cause) => new HelixError({ message: 'invalid graph edge row', cause }),
      ),
    )
    const id = yield* storedId(row.id, 'id')
    const from = ItemId.make(yield* storedId(row.from, 'from'))
    const to = ItemId.make(yield* storedId(row.to, 'to'))
    const origin =
      row.origin === undefined
        ? undefined
        : yield* decodeStoredOrigin(row.origin)
    if (
      (row.mention_span_start === undefined) !==
      (row.mention_span_end === undefined)
    ) {
      return yield* Effect.fail(
        new HelixError({ message: 'mention edge has an incomplete span' }),
      )
    }
    const spanInput =
      row.mention_span_start === undefined || row.mention_span_end === undefined
        ? undefined
        : {
            start: row.mention_span_start,
            end: row.mention_span_end,
          }
    const span =
      spanInput === undefined
        ? undefined
        : yield* Schema.decodeUnknownEffect(MentionSpan)(spanInput).pipe(
            Effect.mapError(
              (cause) =>
                new HelixError({
                  message: 'mention edge has an invalid span',
                  cause,
                }),
            ),
            Effect.filterOrFail(
              (decoded) => decoded.end >= decoded.start,
              () =>
                new HelixError({
                  message: 'mention edge has an invalid ordered span',
                }),
            ),
          )
    const mention =
      row.mention_text === undefined
        ? undefined
        : origin === undefined
          ? yield* Effect.fail(
              new HelixError({ message: 'mention edge is missing origin' }),
            )
          : {
              tenantId: WorkspaceId.make(row.workspace_id),
              itemId: from,
              text: row.mention_text,
              ...(span === undefined ? {} : { span }),
              origin,
            }
    return {
      id,
      from,
      to,
      edge: row.edge,
      ...(origin === undefined ? {} : { origin }),
      ...(mention === undefined ? {} : { mention }),
    }
  })

const propsOf = (item: NewBrainItem): Record<string, PropertyValueInput> => {
  const props: Record<string, PropertyValueInput> = {
    [PROPS.tenantId]: item.tenantId,
    [PROPS.kind]: item.kind,
    [PROPS.label]: item.label,
    [PROPS.origin]: originJson(item.origin),
  }
  if (item.scope !== undefined) {
    props[PROPS.scopeKind] = item.scope.kind
    if (item.scope.kind === 'team') props[PROPS.scopeId] = item.scope.teamId
    if (item.scope.kind === 'user') props[PROPS.scopeId] = item.scope.userId
  }
  if (item.occurredAt !== undefined) {
    props[PROPS.occurredAt] = new Date(
      DateTime.toEpochMillis(item.occurredAt),
    ).toISOString()
  }
  if (item.summary !== undefined) props[PROPS.summary] = item.summary
  if (item.r2Key !== undefined) props[PROPS.r2Key] = item.r2Key
  if (item.sizeBytes !== undefined) props[PROPS.sizeBytes] = item.sizeBytes
  if (item.canonical !== undefined) {
    props[PROPS.canonicalType] = item.canonical.type
    props[PROPS.canonicalValue] = item.canonical.value
    props[SOURCE_KEY_PROP] = item.canonical.value
  }
  if (item.body !== undefined) props[PROPS.body] = item.body
  if (item.indexStatus !== undefined) {
    props[PROPS.indexStatus] = item.indexStatus
  }
  if (item.indexError !== undefined) {
    props[PROPS.indexError] = item.indexError
  }
  return props
}

const propsWithoutR2Key = (
  props: Record<string, PropertyValueInput>,
): Record<string, PropertyValueInput> => {
  const { [PROPS.r2Key]: _r2Key, ...rest } = props
  return rest
}

const propsWithEmbedding = (
  item: NewBrainItem,
  embedding: number[],
): Record<string, PropertyValueInput> => ({
  ...propsOf(item),
  [VECTOR_PROP]: PropertyValue.f32Array(embedding),
})

const itemProps = (): string[] => [...Object.values(PROPS), '$id']

const itemProjection = () => [
  PropertyProjection.renamed('$id', 'id'),
  PropertyProjection.new('workspace_id'),
  PropertyProjection.new('kind'),
  PropertyProjection.new('label'),
  PropertyProjection.new('summary'),
  PropertyProjection.new('r2_key'),
  PropertyProjection.new('canonical_type'),
  PropertyProjection.new('canonical_value'),
  PropertyProjection.new('indexed'),
  PropertyProjection.new(PROPS.indexStatus),
  PropertyProjection.new(PROPS.indexError),
  PropertyProjection.new('origin'),
  PropertyProjection.new('body'),
  PropertyProjection.new(PROPS.scopeKind),
  PropertyProjection.new(PROPS.scopeId),
  PropertyProjection.new(PROPS.occurredAt),
]

const hitProjection = () => [
  ...itemProjection(),
  PropertyProjection.renamed('$distance', 'distance'),
  PropertyProjection.renamed('$score', 'score'),
]

const edgeProjection = () => [
  PropertyProjection.renamed('$id', 'id'),
  Projection.fromEndpoint('$id', 'from'),
  Projection.toEndpoint('$id', 'to'),
  PropertyProjection.renamed('$label', 'edge'),
  PropertyProjection.new(PROPS.tenantId),
  PropertyProjection.new(PROPS.origin),
  PropertyProjection.new(MENTION_PROPS.text),
  PropertyProjection.new(MENTION_PROPS.spanStart),
  PropertyProjection.new(MENTION_PROPS.spanEnd),
]

const waitForIndex = (helix: HelixClientShape, operationId: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 60; attempt++) {
      const request = readBatch()
        .varAs('status', g().getIndexOperation(operationId))
        .returning(['status'])
        .toQueryRequest({ queryName: QUERY.indexStatus })
      const result = yield* helix.run(request)
      const row = firstRow(result, 'status')
      if (row === undefined) {
        return yield* Effect.fail(
          new HelixError({ message: 'index status returned no row' }),
        )
      }
      const status = row.status
      if (status === 'succeeded') return
      if (status === 'aborted' || status === 'blocked') {
        return yield* Effect.fail(
          new HelixError({
            message: `index build ${status}: ${JSON.stringify(row)}`,
          }),
        )
      }
      yield* Effect.sleep(250)
    }
    return yield* Effect.fail(
      new HelixError({ message: `index build timed out: ${operationId}` }),
    )
  })

const SEARCH_FETCH_K = 50
const FRESHNESS_HALF_LIFE_DAYS = 90
const FRESHNESS_FLOOR = 0.25
export const RRF_K = 60
const MAX_EMBED_CHARS = 2000
const EMBED_BATCH_SIZE = 100
const MAX_INDEX_SECTIONS = 1000
const NEIGHBORHOOD_MAX_ITEMS = 50
const NEIGHBORHOOD_MAX_EDGES = 100
const MAX_FILE_LIST_LIMIT = 100

const normalizeFileListLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) {
    return MAX_FILE_LIST_LIMIT
  }

  return Math.min(MAX_FILE_LIST_LIMIT, Math.max(1, Math.trunc(limit)))
}

const truncateForEmbed = (text: string): string =>
  text.length <= MAX_EMBED_CHARS ? text : text.slice(0, MAX_EMBED_CHARS)

const embedBatched = (
  embeddings: EmbeddingsShape,
  texts: readonly string[],
): Effect.Effect<number[][], EmbedError> =>
  Effect.gen(function* () {
    const vectors: number[][] = []
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const result = yield* embeddings.embed(
        texts.slice(i, i + EMBED_BATCH_SIZE),
      )
      vectors.push(...result)
    }

    if (vectors.length !== texts.length) {
      return yield* Effect.fail(
        new EmbedError({
          message: `embedding batch returned ${vectors.length} vectors for ${texts.length} texts`,
        }),
      )
    }

    for (const vector of vectors) {
      if (
        vector.length !== EMBEDDING_DIM ||
        vector.some((value) => !Number.isFinite(value))
      ) {
        return yield* Effect.fail(
          new EmbedError({
            message: 'embedding batch returned an invalid vector',
          }),
        )
      }
    }

    return vectors
  })

const embeddingAt = (
  vectors: readonly number[][],
  index: number,
): Effect.Effect<number[], EmbedError> => {
  const vector = vectors[index]
  return vector === undefined
    ? Effect.fail(
        new EmbedError({ message: `embedding vector ${index} is missing` }),
      )
    : Effect.succeed(vector)
}

/**
 * Maps caller-facing kinds onto the three labels covered by Brain indexes.
 * Previously arbitrary kinds became Helix labels and disappeared from search;
 * now kind remains metadata while storage stays on file, section, or note.
 */
const storageLabelOf = (item: NewBrainItem): string => {
  if (item.kind === LABELS.File) return LABELS.File
  if (item.kind === LABELS.Section) return LABELS.Section
  return LABELS.Note
}

/**
 * Combines ranked result lists with reciprocal-rank fusion. Previously the
 * fused value only sorted hits and callers received a raw source-list score;
 * each returned hit now exposes the score that actually determined its rank.
 */
const fuse = (
  lists: readonly (readonly SearchHit[])[],
  limit: number,
): readonly SearchHit[] => {
  const score = new Map<string, { hit: SearchHit; s: number }>()
  for (const list of lists) {
    list.forEach((hit, i) => {
      const key = String(hit.item.id)
      const current = score.get(key) ?? { hit, s: 0 }
      current.s += 1 / (RRF_K + i + 1)
      score.set(key, current)
    })
  }
  return [...score.values()]
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((entry) => ({ ...entry.hit, score: entry.s }))
}

const retryWriteConflict = <A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E | HelixError, never>,
): Effect.Effect<A, E | HelixError, never> =>
  Effect.retry(effect, {
    times: 3,
    while: (e): boolean => e._tag === 'WriteConflict',
  })

const setProperties = (
  traversal: Traversal<'nodes', 'write'>,
  props: Record<string, PropertyValueInput>,
): Traversal<'nodes', 'write'> => {
  const entries = Object.entries(props)
  const [firstName, firstValue] = entries[0] as [string, PropertyValueInput]
  let result = traversal.setProperty(firstName, firstValue)
  for (const [name, value] of entries.slice(1)) {
    result = result.setProperty(name, value)
  }
  return result
}

const readItem = (
  helix: HelixClientShape,
  itemId: ItemId,
  tenantId: WorkspaceId,
): Effect.Effect<BrainItem | null, HelixError | WriteConflict> =>
  Effect.gen(function* () {
    const request = readBatch()
      .varAs(
        'item',
        g()
          .n([nodeId(itemId)])
          .where(Predicate.eq(PROPS.tenantId, tenantId))
          .valueMap(itemProps()),
      )
      .returning(['item'])
      .toQueryRequest({ queryName: QUERY.read })
    const result = yield* helix.run(request)
    const row = firstRow(result, 'item')
    if (row === undefined) return null
    return yield* decodeRow(row)
  })

/**
 * Reads one workspace file by its Helix storage label. File API routes use
 * this boundary so an item ID cannot expose a note or section as a file.
 */
const readFileItem = (
  helix: HelixClientShape,
  itemId: ItemId,
  tenantId: WorkspaceId,
): Effect.Effect<BrainItem | null, HelixError | WriteConflict> =>
  Effect.gen(function* () {
    const request = readBatch()
      .varAs(
        'file',
        g()
          .n([nodeId(itemId)])
          .where(Predicate.eq('$label', LABELS.File))
          .where(Predicate.eq(PROPS.tenantId, tenantId))
          .valueMap(itemProps()),
      )
      .returning(['file'])
      .toQueryRequest({ queryName: QUERY.read })

    const result = yield* helix.run(request)
    const row = firstRow(result, 'file')
    if (row === undefined) return null

    return yield* decodeRow(row)
  })

/**
 * Selects sections linked to one item that are absent from its latest chunk
 * source keys. Helix's traversal `drop` removes stale nodes and their edges;
 * when chunks have no canonical keys, all old linked sections are replaced.
 */
const staleSectionsOf = (
  item: BrainItem,
  currentSourceKeys: readonly string[],
): Traversal<'nodes', 'write'> => {
  const linkedSections = g()
    .n([nodeId(item.id)])
    .where(Predicate.eq(PROPS.tenantId, item.tenantId))
    .out(EDGES.hasSection)
  const staleSections =
    currentSourceKeys.length === 0
      ? linkedSections
      : linkedSections.where(
          Predicate.not(
            Predicate.isIn(SOURCE_KEY_PROP, [...currentSourceKeys]),
          ),
        )
  return staleSections.drop()
}

/**
 * Builds the Effect-native Brain service over Helix, embeddings, extraction,
 * chunking, and raw storage. The service now keeps storage labels indexed,
 * invalidates changed bodies, prunes stale sections, and logs fused rankings.
 * Helix traversal behavior was verified against the installed v3 SDK source.
 */
export const makeBrain = Effect.gen(function* () {
  const helix = yield* HelixClient
  const embeddings = yield* Embeddings
  const chunker = yield* Chunker
  const extractor = yield* Extractor
  const files = yield* RawFileStore

  /**
   * Stores mentions as parallel `MENTIONS` self-edges on the source item. A
   * node would imply a new knowledge item (and require Garden to assign its
   * kind); edge properties preserve exact text/span/origin append-only without
   * creating an entity or leaking a storage label into the agent's ontology.
   */
  const observeMention = Effect.fn('Brain.observeMention')(function* (input: {
    tenantId: WorkspaceId
    itemId: ItemId
    span?: MentionSpan
    text: string
    actor: Actor
  }) {
    if (input.text.trim() === '') {
      return yield* Effect.fail(
        new HelixError({ message: 'mention text must not be blank' }),
      )
    }
    if (
      input.span !== undefined &&
      (!Number.isInteger(input.span.start) ||
        !Number.isInteger(input.span.end) ||
        input.span.start < 0 ||
        input.span.end < input.span.start)
    ) {
      return yield* Effect.fail(
        new HelixError({
          message: 'mention span must be a valid ordered range',
        }),
      )
    }
    const at = yield* DateTime.now
    const origin: Origin = {
      actor: input.actor,
      fromItem: input.itemId,
      at,
    }
    const properties: Record<string, PropertyValueInput> = {
      [PROPS.tenantId]: input.tenantId,
      [PROPS.origin]: originJson(origin),
      [MENTION_PROPS.text]: input.text,
      ...(input.span === undefined
        ? {}
        : {
            [MENTION_PROPS.spanStart]: input.span.start,
            [MENTION_PROPS.spanEnd]: input.span.end,
          }),
    }
    const request = writeBatch()
      .varAs(
        'source',
        g()
          .n([nodeId(input.itemId)])
          .where(Predicate.eq(PROPS.tenantId, input.tenantId)),
      )
      .varAs(
        'recorded',
        g()
          .n(NodeRef.var('source'))
          .addE(EDGES.mentions, NodeRef.var('source'), properties),
      )
      .returning(['source', 'recorded'])
      .toQueryRequest({ queryName: QUERY.observeMention })
    const result = yield* retryWriteConflict(
      helix.run(request, { awaitDurability: true }),
    )
    if (firstRow(result, 'source') === undefined) {
      return yield* Effect.fail(
        new HelixError({ message: `source item not found: ${input.itemId}` }),
      )
    }
    if (firstRow(result, 'recorded') === undefined) {
      return yield* Effect.fail(
        new HelixError({ message: 'observeMention returned no edge' }),
      )
    }
    return {
      tenantId: input.tenantId,
      itemId: input.itemId,
      text: input.text,
      ...(input.span === undefined ? {} : { span: input.span }),
      origin,
    }
  })

  /**
   * Adds one idempotent caller-labelled edge after tenant-scoped endpoint
   * lookup. `SAME_AS` records only a soft relationship: this method never
   * merges nodes, and canonical-anchor promotion remains an explicit action.
   */
  const linkItems = Effect.fn('Brain.linkItems')(function* (input: {
    tenantId: WorkspaceId
    from: ItemId
    to: ItemId
    edge: string
    actor: Actor
  }) {
    if (input.edge.trim() === '') {
      return yield* Effect.fail(
        new HelixError({ message: 'edge label must not be blank' }),
      )
    }
    const at = yield* DateTime.now
    const request = writeBatch()
      .varAs(
        'from',
        g()
          .n([nodeId(input.from)])
          .where(Predicate.eq(PROPS.tenantId, input.tenantId)),
      )
      .varAs(
        'to',
        g()
          .n([nodeId(input.to)])
          .where(Predicate.eq(PROPS.tenantId, input.tenantId)),
      )
      .varAs(
        'already_targets',
        g().n(NodeRef.var('from')).out(input.edge).has('$id', nodeId(input.to)),
      )
      .varAs('unlinked_to', g().n(NodeRef.var('to')).without('already_targets'))
      .varAsIf(
        'created',
        BatchCondition.varNotEmpty('unlinked_to'),
        g()
          .n(NodeRef.var('from'))
          .addE(input.edge, NodeRef.var('unlinked_to'), {
            [PROPS.tenantId]: input.tenantId,
            [PROPS.origin]: originJson({ actor: input.actor, at }),
          }),
      )
      .returning(['from', 'to', 'already_targets', 'created'])
      .toQueryRequest({ queryName: QUERY.linkItems })
    const result = yield* retryWriteConflict(
      helix.run(request, { awaitDurability: true }),
    )
    if (firstRow(result, 'from') === undefined) {
      return yield* Effect.fail(
        new HelixError({ message: `source item not found: ${input.from}` }),
      )
    }
    if (firstRow(result, 'to') === undefined) {
      return yield* Effect.fail(
        new HelixError({ message: `target item not found: ${input.to}` }),
      )
    }
    return {
      from: input.from,
      to: input.to,
      edge: input.edge,
      created: firstRow(result, 'created') !== undefined,
    }
  })

  /**
   * Expands explicit one- or two-hop traversals and caps every intermediate
   * edge/node stream. Helix `repeat` defaults to a much larger max depth, so it
   * is intentionally absent; response decoding also deduplicates and limits
   * nodes/edges before returning them to callers.
   */
  const neighborhood = Effect.fn('Brain.neighborhood')(function* (input: {
    tenantId: WorkspaceId
    itemId: ItemId
    depth?: number
    viewer?: ScopeViewer
  }) {
    const depth = input.depth ?? 1
    if (!Number.isInteger(depth) || depth < 1 || depth > 2) {
      return yield* Effect.fail(
        new HelixError({ message: 'neighborhood depth must be 1 or 2' }),
      )
    }
    const viewer = input.viewer ?? noViewer
    let batch = readBatch()
      .varAs(
        'root',
        g()
          .n([nodeId(input.itemId)])
          .where(Predicate.eq(PROPS.tenantId, input.tenantId)),
      )
      .varAs('root_item', g().n(NodeRef.var('root')).valueMap(itemProps()))
      .varAs(
        'hop_1',
        g()
          .n(NodeRef.var('root'))
          .bothE()
          .where(Predicate.eq(PROPS.tenantId, input.tenantId))
          .limit(NEIGHBORHOOD_MAX_EDGES)
          .otherN()
          .where(Predicate.eq(PROPS.tenantId, input.tenantId))
          .dedup()
          .limit(NEIGHBORHOOD_MAX_ITEMS),
      )
      .varAs('hop_1_items', g().n(NodeRef.var('hop_1')).valueMap(itemProps()))
      .varAs(
        'hop_1_edges',
        g()
          .n(NodeRef.var('root'))
          .bothE()
          .where(Predicate.eq(PROPS.tenantId, input.tenantId))
          .limit(NEIGHBORHOOD_MAX_EDGES)
          .dedup()
          .project(edgeProjection()),
      )
    const returns = ['root_item', 'hop_1_items', 'hop_1_edges']
    if (depth === 2) {
      batch = batch
        .varAs(
          'hop_2',
          g()
            .n(NodeRef.var('hop_1'))
            .bothE()
            .where(Predicate.eq(PROPS.tenantId, input.tenantId))
            .limit(NEIGHBORHOOD_MAX_EDGES)
            .otherN()
            .where(Predicate.eq(PROPS.tenantId, input.tenantId))
            .dedup()
            .limit(NEIGHBORHOOD_MAX_ITEMS),
        )
        .varAs('hop_2_items', g().n(NodeRef.var('hop_2')).valueMap(itemProps()))
        .varAs(
          'hop_2_edges',
          g()
            .n(NodeRef.var('hop_1'))
            .bothE()
            .where(Predicate.eq(PROPS.tenantId, input.tenantId))
            .limit(NEIGHBORHOOD_MAX_EDGES)
            .dedup()
            .project(edgeProjection()),
        )
      returns.push('hop_2_items', 'hop_2_edges')
    }
    const request = batch
      .returning(returns)
      .toQueryRequest({ queryName: QUERY.neighborhood })
    const result = yield* helix.run(request)
    const rootRow = firstRow(result, 'root_item')
    if (rootRow === undefined) {
      return yield* Effect.fail(
        new HelixError({ message: `item not found: ${input.itemId}` }),
      )
    }
    const rootItem = yield* decodeRow(rootRow)
    if (!visibleTo(rootItem, viewer)) {
      return yield* Effect.fail(
        new HelixError({ message: `item not found: ${input.itemId}` }),
      )
    }
    const decodedItems = yield* Effect.forEach(
      [rootRow, ...rows(result, 'hop_1_items'), ...rows(result, 'hop_2_items')],
      decodeRow,
    )
    const items = EffectArray.dedupeWith(
      decodedItems.filter(
        (item) => item.tenantId === input.tenantId && visibleTo(item, viewer),
      ),
      (left, right) => left.id === right.id,
    ).slice(0, NEIGHBORHOOD_MAX_ITEMS)
    const decodedEdges = yield* Effect.forEach(
      [...rows(result, 'hop_1_edges'), ...rows(result, 'hop_2_edges')],
      rowToBrainEdge,
    )
    const itemIds = new Set(items.map((item) => item.id))
    const edges = EffectArray.dedupeWith(
      decodedEdges.filter(
        (edge) => itemIds.has(edge.from) && itemIds.has(edge.to),
      ),
      (left, right) => left.id === right.id,
    ).slice(0, NEIGHBORHOOD_MAX_EDGES)
    return { items, edges }
  })

  /**
   * Applies only audit-authored kind and summary properties to an existing
   * tenant item. Before this path, canonical upsert could move a file-shaped
   * item onto the note lookup label when an agent invented a free-text kind;
   * direct node mutation now leaves content-derived indexes and storage labels
   * untouched. Helix v3 traversal/setProperty behavior was checked in the
   * installed SDK source.
   */
  const updateItemMetadata = Effect.fn('Brain.updateItemMetadata')(
    function* (input: {
      tenantId: WorkspaceId
      itemId: ItemId
      kind: Kind
      summary: string
    }) {
      const kind = input.kind.trim()
      const summary = input.summary.trim()
      if (kind === '') {
        return yield* Effect.fail(
          new HelixError({ message: 'item kind must not be blank' }),
        )
      }
      if (summary === '') {
        return yield* Effect.fail(
          new HelixError({ message: 'item summary must not be blank' }),
        )
      }

      const request = writeBatch()
        .varAs(
          'updated',
          setProperties(
            g()
              .n([nodeId(input.itemId)])
              .where(
                Predicate.eq(PROPS.tenantId, input.tenantId),
              ) as unknown as Traversal<'nodes', 'write'>,
            {
              [PROPS.kind]: kind,
              [PROPS.summary]: summary,
            },
          ),
        )
        .returning(['updated'])
        .toQueryRequest({ queryName: QUERY.updateItemMetadata })
      const result = yield* retryWriteConflict(
        helix.run(request, { awaitDurability: true }),
      )
      if (firstRow(result, 'updated') === undefined) {
        return yield* Effect.fail(
          new HelixError({ message: `item not found: ${input.itemId}` }),
        )
      }
      return yield* readItem(helix, input.itemId, input.tenantId).pipe(
        Effect.flatMap((loaded) =>
          loaded === null
            ? Effect.fail(
                new HelixError({
                  message: `item not found after metadata update: ${input.itemId}`,
                }),
              )
            : Effect.succeed(loaded),
        ),
      )
    },
  )

  /**
   * Persists the file indexing lifecycle independently from the indexing work.
   * Before this operation, an indexing failure left `indexed` false forever,
   * which made failed files indistinguishable from active work.
   */
  const updateIndexStatus = Effect.fn('Brain.updateIndexStatus')(
    function* (input: {
      itemId: ItemId
      tenantId: WorkspaceId
      status: BrainIndexStatus
      error?: string
    }) {
      const request = writeBatch()
        .varAs(
          'updated',
          setProperties(
            g()
              .n([nodeId(input.itemId)])
              .where(
                Predicate.eq(PROPS.tenantId, input.tenantId),
              ) as unknown as Traversal<'nodes', 'write'>,
            {
              [PROPS.indexStatus]: input.status,
              [PROPS.indexError]: input.error?.trim() ?? '',
              [PROPS.indexed]: input.status === 'ready',
            },
          ),
        )
        .returning(['updated'])
        .toQueryRequest({ queryName: QUERY.updateIndexStatus })

      const result = yield* retryWriteConflict(
        helix.run(request, { awaitDurability: true }),
      )

      if (firstRow(result, 'updated') === undefined) {
        return yield* Effect.fail(
          new HelixError({ message: `item not found: ${input.itemId}` }),
        )
      }

      return yield* readItem(helix, input.itemId, input.tenantId).pipe(
        Effect.flatMap((loaded) =>
          loaded === null
            ? Effect.fail(
                new HelixError({
                  message: `item not found after status update: ${input.itemId}`,
                }),
              )
            : Effect.succeed(loaded),
        ),
      )
    },
  )

  /**
   * Removes one workspace-scoped file and its derived section nodes. The
   * returned item keeps the R2 key available for object cleanup by the caller.
   * Separate Helix writes keep each delete query simple. A retry can safely
   * finish the operation if section deletion succeeds but file deletion fails.
   */
  const deleteFile = Effect.fn('Brain.deleteFile')(function* (
    itemId: ItemId,
    tenantId: WorkspaceId,
  ) {
    const item = yield* readFileItem(helix, itemId, tenantId)
    if (item === null) return null

    const sectionsRequest = writeBatch()
      .varAs(
        'sections',
        g()
          .n([nodeId(item.id)])
          .where(Predicate.eq('$label', LABELS.File))
          .where(Predicate.eq(PROPS.tenantId, tenantId))
          .out(EDGES.hasSection)
          .drop(),
      )
      .returning(['sections'])
      .toQueryRequest({ queryName: QUERY.deleteFile })

    yield* retryWriteConflict(
      helix.run(sectionsRequest, { awaitDurability: true }),
    )

    const fileRequest = writeBatch()
      .varAs(
        'file',
        g()
          .n([nodeId(item.id)])
          .where(Predicate.eq('$label', LABELS.File))
          .where(Predicate.eq(PROPS.tenantId, tenantId))
          .drop(),
      )
      .returning(['file'])
      .toQueryRequest({ queryName: QUERY.deleteFile })

    yield* retryWriteConflict(helix.run(fileRequest, { awaitDurability: true }))

    return item
  })

  return Brain.of({
    ensureIndexes: () =>
      Effect.gen(function* () {
        const request = writeBatch()
          .varAs(
            'idx_file_vector',
            g().createIndexIfNotExists(
              IndexSpec.nodeVector(
                LABELS.File,
                VECTOR_PROP,
                EMBEDDING_DIM,
                VectorDistanceMetric.Cosine,
                PROPS.tenantId,
              ),
            ),
          )
          .varAs(
            'idx_file_text',
            g().createIndexIfNotExists(
              IndexSpec.nodeText(LABELS.File, PROPS.body, PROPS.tenantId),
            ),
          )
          .varAs(
            'idx_section_vector',
            g().createIndexIfNotExists(
              IndexSpec.nodeVector(
                LABELS.Section,
                VECTOR_PROP,
                EMBEDDING_DIM,
                VectorDistanceMetric.Cosine,
                PROPS.tenantId,
              ),
            ),
          )
          .varAs(
            'idx_section_text',
            g().createIndexIfNotExists(
              IndexSpec.nodeText(LABELS.Section, PROPS.body, PROPS.tenantId),
            ),
          )
          .varAs(
            'idx_note_vector',
            g().createIndexIfNotExists(
              IndexSpec.nodeVector(
                LABELS.Note,
                VECTOR_PROP,
                EMBEDDING_DIM,
                VectorDistanceMetric.Cosine,
                PROPS.tenantId,
              ),
            ),
          )
          .varAs(
            'idx_note_text',
            g().createIndexIfNotExists(
              IndexSpec.nodeText(LABELS.Note, PROPS.body, PROPS.tenantId),
            ),
          )
          .varAs(
            'idx_file_source',
            g().createIndexIfNotExists(
              IndexSpec.nodeEquality(LABELS.File, SOURCE_KEY_PROP),
            ),
          )
          .varAs(
            'idx_section_source',
            g().createIndexIfNotExists(
              IndexSpec.nodeEquality(LABELS.Section, SOURCE_KEY_PROP),
            ),
          )
          .returning([
            'idx_file_vector',
            'idx_file_text',
            'idx_section_vector',
            'idx_section_text',
            'idx_note_vector',
            'idx_note_text',
            'idx_file_source',
            'idx_section_source',
          ])
          .toQueryRequest({ queryName: QUERY.ensureIndexes })
        const result = yield* helix.run(request)
        const operationIds = toRows(result['idx_file_vector'])
          .concat(toRows(result['idx_file_text']))
          .concat(toRows(result['idx_section_vector']))
          .concat(toRows(result['idx_section_text']))
          .concat(toRows(result['idx_note_vector']))
          .concat(toRows(result['idx_note_text']))
          .concat(toRows(result['idx_file_source']))
          .concat(toRows(result['idx_section_source']))
          .flatMap((row) => {
            const id = row.operation_id
            return typeof id === 'string' ? [id] : []
          })
        yield* Effect.forEach(operationIds, (id) => waitForIndex(helix, id), {
          concurrency: 'unbounded',
        })
      }),
    addItem: (input) =>
      Effect.gen(function* () {
        const item = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(NewBrainItem)(input),
          catch: (cause) =>
            new HelixError({ message: 'invalid brain item', cause }),
        })
        const props = propsOf(item)
        const storageLabel = storageLabelOf(item)
        const sourceKey = item.canonical?.value
        if (sourceKey === undefined) {
          const request = writeBatch()
            .varAs('created', g().addN(storageLabel, props))
            .returning(['created'])
            .toQueryRequest({ queryName: QUERY.index })
          const result = yield* retryWriteConflict(
            helix.run(request, { awaitDurability: true }),
          )
          const row = firstRow(result, 'created')
          if (row === undefined) {
            return yield* Effect.fail(
              new HelixError({ message: 'addItem returned no node' }),
            )
          }
          const itemId = yield* decodeItemId(row)
          return yield* readItem(helix, itemId, item.tenantId).pipe(
            Effect.flatMap((loaded) =>
              loaded === null
                ? Effect.fail(
                    new HelixError({ message: 'item not found after add' }),
                  )
                : Effect.succeed(loaded),
            ),
          )
        }
        const request = writeBatch()
          .varAs(
            'existing',
            g()
              .nWithLabelWhere(
                storageLabel,
                SourcePredicate.eq(SOURCE_KEY_PROP, sourceKey),
              )
              .where(Predicate.eq(PROPS.tenantId, item.tenantId)),
          )
          .varAsIf(
            'created',
            BatchCondition.varEmpty('existing'),
            g().addN(storageLabel, props),
          )
          .varAsIf(
            'updated',
            BatchCondition.varNotEmpty('existing'),
            setProperties(
              g().n(NodeRef.var('existing')) as unknown as Traversal<
                'nodes',
                'write'
              >,
              propsWithoutR2Key(props),
            )
              .setProperty(PROPS.indexed, false)
              .setProperty(PROPS.indexError, ''),
          )
          .returning(['created', 'updated'])
          .toQueryRequest({ queryName: QUERY.index })
        const result = yield* retryWriteConflict(
          helix.run(request, { awaitDurability: true }),
        )
        const created = firstRow(result, 'created')
        const updated = firstRow(result, 'updated')
        const row = created ?? updated
        if (row === undefined) {
          return yield* Effect.fail(
            new HelixError({ message: 'addItem returned no node' }),
          )
        }
        const itemId = yield* decodeItemId(row)
        return yield* readItem(helix, itemId, item.tenantId).pipe(
          Effect.flatMap((loaded) =>
            loaded === null
              ? Effect.fail(
                  new HelixError({ message: 'item not found after addItem' }),
                )
              : Effect.succeed(loaded),
          ),
        )
      }),
    addText: ({ tenantId, label, body, kind, summary, scope, actor }) =>
      Effect.gen(function* () {
        const item: NewBrainItem = {
          tenantId,
          kind: kind ?? Kind.make(LABELS.Note),
          label,
          ...(summary === undefined ? {} : { summary }),
          ...(scope === undefined ? {} : { scope }),
          body,
          origin: { actor, at: DateTime.makeUnsafe(new Date()) },
        }
        const vectors = yield* embedBatched(embeddings, [body])
        const vector = yield* embeddingAt(vectors, 0)
        const props = {
          ...propsWithEmbedding(item, vector),
          [PROPS.indexed]: true,
        }
        const request = writeBatch()
          .varAs('created', g().addN(storageLabelOf(item), props))
          .returning(['created'])
          .toQueryRequest({ queryName: QUERY.index })
        const result = yield* retryWriteConflict(
          helix.run(request, { awaitDurability: true }),
        )
        const row = firstRow(result, 'created')
        if (row === undefined) {
          return yield* Effect.fail(
            new HelixError({ message: 'addText returned no node' }),
          )
        }
        const itemId = yield* decodeItemId(row)
        return yield* readItem(helix, itemId, item.tenantId).pipe(
          Effect.flatMap((loaded) =>
            loaded === null
              ? Effect.fail(
                  new HelixError({ message: 'item not found after addText' }),
                )
              : Effect.succeed(loaded),
          ),
        )
      }),
    updateItemMetadata,
    updateIndexStatus,
    deleteFile,
    index: (itemId, tenantId) =>
      Effect.gen(function* () {
        const item = yield* readItem(helix, itemId, tenantId).pipe(
          Effect.flatMap((loaded) =>
            loaded === null
              ? Effect.fail(
                  new HelixError({ message: `item not found: ${itemId}` }),
                )
              : Effect.succeed(loaded),
          ),
        )
        const key = item.r2Key ?? item.canonical?.value
        if (key === undefined) {
          return yield* Effect.fail(
            new HelixError({ message: `item has no source file: ${itemId}` }),
          )
        }
        const bytes = yield* files.read(key)
        const doc = yield* extractor.extractFromBytes(key, bytes)
        const chunks = yield* chunker.chunk({ ...doc, body: doc.body })
        const boundedChunks = chunks.slice(0, MAX_INDEX_SECTIONS)
        const sectionBodies = boundedChunks.map((chunk) =>
          truncateForEmbed(chunk.body),
        )
        const fileText = truncateForEmbed(
          [doc.title, item.summary].filter(Boolean).join('\n\n') ||
            doc.body ||
            '',
        )
        const vectors = yield* embedBatched(embeddings, [
          fileText,
          ...sectionBodies,
        ])
        const fileVector = yield* embeddingAt(vectors, 0)
        const sectionVectors = vectors.slice(1)

        const sectionEntries = yield* Effect.forEach(
          boundedChunks,
          (chunk, i) =>
            Effect.map(embeddingAt(sectionVectors, i), (vector) => {
              const section: NewBrainItem = {
                tenantId: item.tenantId,
                kind: Kind.make('section'),
                label: chunk.title,
                body: chunk.body,
                r2Key: item.r2Key,
                scope: scopeOf(item),
                canonical:
                  item.canonical === undefined
                    ? undefined
                    : {
                        type: 'section',
                        value: `${item.canonical.value}#${chunk.path ?? chunk.title}`,
                      },
                origin: {
                  actor: item.origin.actor,
                  fromItem: item.id,
                  at: item.origin.at,
                },
              }
              return {
                section,
                props: propsWithEmbedding(section, vector),
              }
            }),
        )

        const existingRequest = readBatch()
          .varAs(
            'existing',
            g()
              .n([nodeId(item.id)])
              .where(Predicate.eq(PROPS.tenantId, item.tenantId))
              .out(EDGES.hasSection)
              .valueMap(itemProps()),
          )
          .returning(['existing'])
          .toQueryRequest({ queryName: QUERY.sectionsOf })
        const existingResult = yield* helix.run(existingRequest)
        const existingRows = rows(existingResult, 'existing').filter(
          (row) => row.workspace_id === item.tenantId,
        )
        const newSourceKeys = new Set(
          sectionEntries
            .map((entry) => entry.section.canonical?.value)
            .filter((value): value is string => value !== undefined),
        )
        const orphanRows = existingRows.filter((row) => {
          const canonical = row.canonical_value
          return !(
            typeof canonical === 'string' && newSourceKeys.has(canonical)
          )
        })
        const orphanIds = yield* Effect.forEach(orphanRows, decodeItemId)

        const indexedItem: NewBrainItem = {
          ...item,
          body: doc.body,
          summary: item.summary ?? doc.title,
          indexStatus: 'ready',
          indexError: '',
        }
        const fileProps = propsWithEmbedding(indexedItem, fileVector)
        const fileUpdate = setProperties(
          g()
            .n([nodeId(item.id)])
            .where(
              Predicate.eq(PROPS.tenantId, item.tenantId),
            ) as unknown as Traversal<'nodes', 'write'>,
          fileProps,
        ).setProperty(PROPS.indexed, true)

        let nodeBatch = writeBatch().varAs('file', fileUpdate)
        const sectionNames: string[] = []
        const updatedNames: string[] = []
        for (const [i, entry] of sectionEntries.entries()) {
          const sourceKey = entry.section.canonical?.value
          if (sourceKey === undefined) {
            sectionNames.push(`section${i}`)
            nodeBatch = nodeBatch.varAs(
              `section${i}`,
              g().addN(LABELS.Section, entry.props),
            )
          } else {
            updatedNames.push(`updated${i}`)
            sectionNames.push(`section${i}`)
            nodeBatch = nodeBatch
              .varAs(
                `existing${i}`,
                g()
                  .nWithLabelWhere(
                    LABELS.Section,
                    SourcePredicate.eq(SOURCE_KEY_PROP, sourceKey),
                  )
                  .where(Predicate.eq(PROPS.tenantId, entry.section.tenantId)),
              )
              .varAsIf(
                `section${i}`,
                BatchCondition.varEmpty(`existing${i}`),
                g().addN(LABELS.Section, entry.props),
              )
              .varAsIf(
                `updated${i}`,
                BatchCondition.varNotEmpty(`existing${i}`),
                setProperties(
                  g().n(NodeRef.var(`existing${i}`)) as unknown as Traversal<
                    'nodes',
                    'write'
                  >,
                  entry.props,
                ),
              )
          }
        }
        orphanIds.forEach((orphanId, i) => {
          nodeBatch = nodeBatch.varAs(
            `orphan${i}`,
            g()
              .n([nodeId(orphanId)])
              .drop(),
          )
        })
        const nodeResult = yield* retryWriteConflict(
          helix.run(
            nodeBatch
              .returning([
                'file',
                ...sectionNames,
                ...updatedNames,
                ...orphanIds.map((_, i) => `orphan${i}`),
              ])
              .toQueryRequest({ queryName: QUERY.index }),
            { awaitDurability: true },
          ),
        )
        const sectionIds = yield* Effect.forEach(sectionEntries, (_, i) => {
          const created = firstRow(nodeResult, `section${i}`)
          const updated = firstRow(nodeResult, `updated${i}`)
          const row = created ?? updated
          if (row === undefined) {
            return Effect.fail(
              new HelixError({ message: `index did not return section ${i}` }),
            )
          }
          return decodeItemId({ ...row, $id: row.$id ?? row.id })
        })

        const currentSourceKeys = sectionEntries
          .map((entry) => entry.section.canonical?.value)
          .filter((sourceKey): sourceKey is string => sourceKey !== undefined)
        const staleRequest = writeBatch()
          .varAs('stale_sections', staleSectionsOf(item, currentSourceKeys))
          .returning(['stale_sections'])
          .toQueryRequest({ queryName: QUERY.index })
        yield* retryWriteConflict(
          helix.run(staleRequest, { awaitDurability: true }),
        )

        let edgeBatch = writeBatch().varAs(
          'file',
          g()
            .n([nodeId(item.id)])
            .where(Predicate.eq(PROPS.tenantId, item.tenantId)),
        )
        sectionIds.forEach((sectionId, i) => {
          edgeBatch = edgeBatch
            .varAs(
              `already${i}`,
              g()
                .n(NodeRef.var('file'))
                .out(EDGES.hasSection)
                .has('$id', nodeId(sectionId)),
            )
            .varAsIf(
              `edge${i}`,
              BatchCondition.varEmpty(`already${i}`),
              g()
                .n(NodeRef.var('file'))
                .addE(EDGES.hasSection, [nodeId(sectionId)], {
                  [PROPS.tenantId]: item.tenantId,
                }),
            )
        })
        const edgeRequest = edgeBatch
          .returning(sectionIds.map((_, i) => `edge${i}`))
          .toQueryRequest({ queryName: QUERY.linkSections })
        yield* retryWriteConflict(
          helix.run(edgeRequest, { awaitDurability: true }),
        )
        return yield* readItem(helix, itemId, tenantId).pipe(
          Effect.flatMap((loaded) =>
            loaded === null
              ? Effect.fail(
                  new HelixError({ message: `item not found: ${itemId}` }),
                )
              : Effect.succeed(loaded),
          ),
        )
      }),
    read: (id, tenantId, viewer) =>
      Effect.gen(function* () {
        const request = readBatch()
          .varAs(
            'item',
            g()
              .n([nodeId(id)])
              .where(Predicate.eq(PROPS.tenantId, tenantId))
              .valueMap(itemProps()),
          )
          .returning(['item'])
          .toQueryRequest({ queryName: QUERY.read })
        const result = yield* helix.run(request)
        const row = firstRow(result, 'item')
        if (row === undefined) return null
        if (row.workspace_id !== tenantId) return null
        const item = yield* decodeRow(row)
        return visibleTo(item, viewer ?? noViewer) ? item : null
      }),
    readFileItem: (id, tenantId, viewer) =>
      Effect.gen(function* () {
        const item = yield* readFileItem(helix, id, tenantId)
        if (item === null) return null
        return visibleTo(item, viewer ?? noViewer) ? item : null
      }),

    listFiles: ({ tenantId, limit, viewer }) =>
      Effect.gen(function* () {
        const request = readBatch()
          .varAs(
            'files',
            g()
              .nWithLabelWhere(
                LABELS.File,
                SourcePredicate.eq(PROPS.tenantId, tenantId),
              )
              .orderBy(PROPS.label, Order.Asc)
              .limit(normalizeFileListLimit(limit))
              .valueMap(itemProps()),
          )
          .returning(['files'])
          .toQueryRequest({ queryName: QUERY.listFiles })

        const result = yield* helix.run(request)
        const decodedFiles = yield* Effect.forEach(
          rows(result, 'files'),
          decodeRow,
        )

        return decodedFiles.filter(
          (file) =>
            file.tenantId === tenantId && visibleTo(file, viewer ?? noViewer),
        )
      }),
    search: ({ tenantId, query, k, viewer }) =>
      Effect.gen(function* () {
        const queryVectors = yield* embedBatched(embeddings, [query])
        const queryVector = yield* embeddingAt(queryVectors, 0)
        const request = readBatch()
          .varAs(
            'semantic_file',
            g()
              .vectorSearchNodes(
                LABELS.File,
                VECTOR_PROP,
                queryVector,
                SEARCH_FETCH_K,
                tenantId,
              )
              .project(hitProjection()),
          )
          .varAs(
            'semantic_section',
            g()
              .vectorSearchNodes(
                LABELS.Section,
                VECTOR_PROP,
                queryVector,
                SEARCH_FETCH_K,
                tenantId,
              )
              .project(hitProjection()),
          )
          .varAs(
            'keyword_file',
            g()
              .textSearchNodes(
                LABELS.File,
                PROPS.body,
                query,
                SEARCH_FETCH_K,
                tenantId,
              )
              .project(hitProjection()),
          )
          .varAs(
            'keyword_section',
            g()
              .textSearchNodes(
                LABELS.Section,
                PROPS.body,
                query,
                SEARCH_FETCH_K,
                tenantId,
              )
              .project(hitProjection()),
          )
          .varAs(
            'semantic_note',
            g()
              .vectorSearchNodes(
                LABELS.Note,
                VECTOR_PROP,
                queryVector,
                SEARCH_FETCH_K,
                tenantId,
              )
              .project(hitProjection()),
          )
          .varAs(
            'keyword_note',
            g()
              .textSearchNodes(
                LABELS.Note,
                PROPS.body,
                query,
                SEARCH_FETCH_K,
                tenantId,
              )
              .project(hitProjection()),
          )
          .returning([
            'semantic_file',
            'semantic_section',
            'keyword_file',
            'keyword_section',
            'semantic_note',
            'keyword_note',
          ])
          .toQueryRequest({ queryName: QUERY.search })
        const result = yield* helix.run(request)
        const rowToHit = (row: Row): Effect.Effect<SearchHit, HelixError> =>
          Effect.gen(function* () {
            const bm25Score =
              typeof row.score === 'number' ? row.score : undefined
            const distance =
              typeof row.distance === 'number' ? row.distance : undefined
            const item = yield* decodeRow(row)
            return {
              item,
              score: bm25Score ?? distance ?? 0,
              ...(bm25Score === undefined ? {} : { bm25Score }),
              ...(distance === undefined ? {} : { distance }),
              cite: row.r2_key as string | undefined,
            }
          })
        const filterTenant = (rows: readonly Row[]): readonly Row[] =>
          rows.filter((row) => row.workspace_id === tenantId)
        const lists: readonly (readonly SearchHit[])[] = yield* Effect.forEach(
          [
            'semantic_file',
            'semantic_section',
            'keyword_file',
            'keyword_section',
            'semantic_note',
            'keyword_note',
          ],
          (name) =>
            Effect.forEach(filterTenant(rows(result, name)), rowToHit, {
              concurrency: 'unbounded',
            }),
        )
        const visibleLists = lists.map((list) =>
          list.filter((hit) => visibleTo(hit.item, viewer ?? noViewer)),
        )
        const fused = fuse(visibleLists, SEARCH_FETCH_K)
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now)
        const reranked = rerankByFreshness(
          fused.map((hit) => ({
            item: hit,
            score: hit.score,
            observedAtMs: DateTime.toEpochMillis(
              hit.item.occurredAt ?? hit.item.origin.at,
            ),
          })),
          {
            nowMs,
            halfLifeDays: FRESHNESS_HALF_LIFE_DAYS,
            floor: FRESHNESS_FLOOR,
          },
        ).map((entry) => ({
          ...entry.item,
          freshness: entry.freshness,
          rankScore: entry.rankScore,
        }))
        const hits = reranked.slice(0, k)
        yield* Effect.logDebug('Brain.search.completed').pipe(
          Effect.annotateLogs({
            query,
            hitCount: hits.length,
            topHits: hits.slice(0, 5).map((hit) => ({
              itemId: hit.item.id,
              fusedScore: hit.score,
              rankScore: hit.rankScore,
            })),
          }),
        )
        return hits
      }),
    linkSections: (fileId, sectionIds, tenantId) =>
      Effect.gen(function* () {
        let batch = writeBatch().varAs(
          'file',
          g()
            .n([nodeId(fileId)])
            .where(Predicate.eq(PROPS.tenantId, tenantId)),
        )
        sectionIds.forEach((sectionId, i) => {
          batch = batch
            .varAs(
              `already${i}`,
              g()
                .n(NodeRef.var('file'))
                .out(EDGES.hasSection)
                .has('$id', nodeId(sectionId)),
            )
            .varAsIf(
              `edge${i}`,
              BatchCondition.varEmpty(`already${i}`),
              g()
                .n(NodeRef.var('file'))
                .addE(EDGES.hasSection, [nodeId(sectionId)], {
                  [PROPS.tenantId]: tenantId,
                }),
            )
        })
        const request = batch
          .returning(sectionIds.map((_, i) => `edge${i}`))
          .toQueryRequest({ queryName: QUERY.linkSections })
        yield* retryWriteConflict(helix.run(request, { awaitDurability: true }))
      }),
    sectionsOf: (fileId, tenantId, viewer) =>
      Effect.gen(function* () {
        const request = readBatch()
          .varAs(
            'sections',
            g()
              .n([nodeId(fileId)])
              .where(Predicate.eq(PROPS.tenantId, tenantId))
              .out(EDGES.hasSection)
              .valueMap(itemProps()),
          )
          .returning(['sections'])
          .toQueryRequest({ queryName: QUERY.sectionsOf })
        const result = yield* helix.run(request)
        const decoded = yield* Effect.forEach(
          rows(result, 'sections').filter(
            (row) => row.workspace_id === tenantId,
          ),
          (row) => decodeRow(row),
        )
        return decoded.filter((item) => visibleTo(item, viewer ?? noViewer))
      }),
    observeMention,
    linkItems,
    neighborhood,
    readFile: (itemId, tenantId, range, viewer) =>
      Effect.gen(function* () {
        const item = yield* readFileItem(helix, itemId, tenantId).pipe(
          Effect.flatMap((loaded) =>
            loaded === null
              ? Effect.fail(
                  new HelixError({ message: `item not found: ${itemId}` }),
                )
              : Effect.succeed(loaded),
          ),
        )
        if (!visibleTo(item, viewer ?? noViewer)) {
          return yield* Effect.fail(
            new HelixError({ message: `item not found: ${itemId}` }),
          )
        }
        const key = item.r2Key ?? item.canonical?.value
        if (key === undefined) {
          return yield* Effect.fail(
            new HelixError({ message: `item has no source file: ${itemId}` }),
          )
        }
        return yield* files.read(key, range)
      }),
  })
})
