import {
  Context,
  Effect,
  Layer,
  Option,
  PubSub,
  Schedule,
  Stream,
} from 'effect'
import type {
  DocumentArtifactError,
  DocumentArtifactEvent,
  DocumentOperation,
  DocumentOperationOutcome,
  DocumentSnapshot,
} from './document-artifact-model'
import { DocumentArtifactEvent as DocumentArtifactEventSchema } from './document-artifact-model'

export interface DocumentArtifactEventsService {
  readonly publish: (event: DocumentArtifactEvent) => Effect.Effect<void>
  readonly subscribe: (
    documentId: string,
    initial: Effect.Effect<DocumentSnapshot, DocumentArtifactError>,
  ) => Stream.Stream<DocumentArtifactEvent, DocumentArtifactError>
}

/** Ephemeral live-update port; durable canonical state stays in the repository. */
export class DocumentArtifactEvents extends Context.Service<
  DocumentArtifactEvents,
  DocumentArtifactEventsService
>()('@garden/documents/DocumentArtifactEvents') {}

/**
 * Produces a compact broadcast only when the repository committed a revision.
 * Pure conflicts, duplicates, and no-ops stay request-local and never masquerade
 * as collaboration updates.
 */
export function documentArtifactOperationEvent(args: {
  documentId: string
  operation: DocumentOperation
  outcome: DocumentOperationOutcome
}): Option.Option<DocumentArtifactEvent> {
  if (
    args.outcome._tag !== 'Applied' &&
    (args.outcome._tag !== 'Conflict' || !args.outcome.committed)
  ) {
    return Option.none()
  }
  return Option.some(
    DocumentArtifactEventSchema.cases.Operation.make({
      documentId: args.documentId,
      operationId: args.operation.operationId,
      senderId: args.operation.senderId,
      revision: args.outcome.snapshot.revision,
      title: args.outcome.snapshot.title,
      upserts: args.outcome.accepted,
      deletedIds: args.outcome.deletedIds,
      order: args.outcome.snapshot.blocks.map((block) => block.id),
      lastModified: args.outcome.snapshot.lastModified,
    }),
  )
}

/**
 * Creates a bounded, revision-aware broadcast source for one facet lifetime.
 * A subscription is installed before its initial snapshot is read, so writes
 * racing with connect are buffered and cannot disappear between GET and live
 * delivery. Slow clients can detect a skipped revision and reload a snapshot.
 */
export const documentArtifactEventsLayer: Layer.Layer<DocumentArtifactEvents> =
  Layer.effect(
    DocumentArtifactEvents,
    Effect.gen(function* () {
      const events = yield* PubSub.sliding<DocumentArtifactEvent>(64)

      return DocumentArtifactEvents.of({
        publish: Effect.fn('DocumentArtifactEvents.publish')((event) =>
          PubSub.publish(events, event).pipe(Effect.asVoid),
        ),
        subscribe: (documentId, initial) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(events)
              const snapshot = yield* initial
              const updates = Stream.fromEffect(PubSub.take(subscription)).pipe(
                Stream.repeat(Schedule.forever),
                Stream.filter((event) => event.documentId === documentId),
              )
              return Stream.concat(
                Stream.make(
                  DocumentArtifactEventSchema.cases.Snapshot.make({
                    documentId,
                    snapshot,
                  }),
                ),
                updates,
              )
            }),
          ),
      })
    }),
  )
