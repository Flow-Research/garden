import { Schema } from 'effect'
import { BrainScope, orgScope } from './scope.ts'

export const WorkspaceId = Schema.String.pipe(Schema.brand('WorkspaceId'))
export type WorkspaceId = typeof WorkspaceId.Type

export const ItemId = Schema.String.pipe(Schema.brand('ItemId'))
export type ItemId = typeof ItemId.Type

export const Kind = Schema.String.pipe(Schema.brand('Kind'))
export type Kind = typeof Kind.Type

export const BrainIndexStatus = Schema.Literals([
  'processing',
  'ready',
  'failed',
])
export type BrainIndexStatus = typeof BrainIndexStatus.Type

export const MentionSpan = Schema.Struct({
  start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  end: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type MentionSpan = typeof MentionSpan.Type

export class AgentActor extends Schema.Class<AgentActor>('AgentActor')({
  _tag: Schema.tag('Agent'),
  agentId: Schema.String,
  runId: Schema.String,
}) {}

export class HumanActor extends Schema.Class<HumanActor>('HumanActor')({
  _tag: Schema.tag('Human'),
  userId: Schema.String,
}) {}

export const Actor = Schema.Union([AgentActor, HumanActor])
export type Actor = typeof Actor.Type

export class Origin extends Schema.Class<Origin>('Origin')({
  actor: Actor,
  fromItem: Schema.optional(ItemId),
  at: Schema.DateTimeUtc,
}) {}

export class Canonical extends Schema.Class<Canonical>('Canonical')({
  type: Schema.String,
  value: Schema.String,
}) {}

export class BrainItem extends Schema.Class<BrainItem>('BrainItem')({
  id: ItemId,
  tenantId: WorkspaceId,
  kind: Kind,
  label: Schema.String,
  summary: Schema.optional(Schema.String),
  r2Key: Schema.optional(Schema.String),
  /** Byte size of the staged upload; feeds the Files & Folders size column. */
  sizeBytes: Schema.optional(Schema.Number),
  canonical: Schema.optional(Canonical),
  indexed: Schema.Boolean,
  indexStatus: Schema.optional(BrainIndexStatus),
  indexError: Schema.optional(Schema.String),
  origin: Origin,
  body: Schema.optional(Schema.String),
  scope: Schema.optional(BrainScope),
  occurredAt: Schema.optional(Schema.DateTimeUtc),
}) {}

export class NewBrainItem extends Schema.Class<NewBrainItem>('NewBrainItem')({
  tenantId: WorkspaceId,
  kind: Kind,
  label: Schema.String,
  summary: Schema.optional(Schema.String),
  r2Key: Schema.optional(Schema.String),
  sizeBytes: Schema.optional(Schema.Number),
  canonical: Schema.optional(Canonical),
  indexStatus: Schema.optional(BrainIndexStatus),
  indexError: Schema.optional(Schema.String),
  origin: Origin,
  body: Schema.optional(Schema.String),
  scope: Schema.optional(BrainScope),
  occurredAt: Schema.optional(Schema.DateTimeUtc),
}) {}

export class SearchHit extends Schema.Class<SearchHit>('SearchHit')({
  item: BrainItem,
  score: Schema.Number,
  bm25Score: Schema.optional(Schema.Number),
  distance: Schema.optional(Schema.Number),
  cite: Schema.optional(Schema.String),
  freshness: Schema.optional(Schema.Number),
  rankScore: Schema.optional(Schema.Number),
}) {}

export const MentionObservation = Schema.Struct({
  tenantId: WorkspaceId,
  itemId: ItemId,
  text: Schema.String,
  span: Schema.optionalKey(MentionSpan),
  origin: Origin,
})
export type MentionObservation = typeof MentionObservation.Type

export const BrainEdge = Schema.Struct({
  id: Schema.String,
  from: ItemId,
  to: ItemId,
  edge: Schema.String,
  origin: Schema.optionalKey(Origin),
  mention: Schema.optionalKey(MentionObservation),
})
export type BrainEdge = typeof BrainEdge.Type

export const BrainNeighborhood = Schema.Struct({
  items: Schema.Array(BrainItem),
  edges: Schema.Array(BrainEdge),
})
export type BrainNeighborhood = typeof BrainNeighborhood.Type

export const scopeOf = (item: { readonly scope?: BrainScope }): BrainScope =>
  item.scope ?? orgScope()
