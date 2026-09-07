import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import {
  buildContentDisposition,
  normalizeDownloadFilename,
} from '@garden/agent-runtime'
import { ItemId, Kind, WorkspaceId, type BrainItem } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import { ensureAgentRow } from '@/lib/server/chat-agents'
import { getDb } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'
import { BrainAuditClient } from '@/lib/server/brain-audit-runtime'

const brainIngestionLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'brain-ingestion',
})

export class BrainFileIngestionError extends Schema.TaggedError<BrainFileIngestionError>()(
  'BrainFileIngestionError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface BrainFileIngestionService {
  readonly stage: (input: {
    file: File
    itemId: string
    ownerUserId: string
    r2Key: string
    workspaceId: string
  }) => Effect.Effect<BrainItem, BrainFileIngestionError>
  readonly indexAndAudit: (input: {
    itemId: string
    ownerUserId: string
    workspaceId: string
  }) => Effect.Effect<void>
}

export class BrainFileIngestion extends Context.Service<
  BrainFileIngestion,
  BrainFileIngestionService
>()('@garden/web/BrainFileIngestion') {}

const messageFromUnknown = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

/**
 * Owns upload adoption and the best-effort mechanical-index → agent-audit
 * pipeline. R2, database, and AgentDO Promises enter through narrow adapters;
 * orchestration remains one Effect service and upload failures retain cleanup.
 */
export const makeBrainFileIngestionLayer = (
  env: Pick<AppEnv, 'BRAIN_FILES' | 'HYPERDRIVE'>,
): Layer.Layer<BrainFileIngestion, never, Brain | BrainAuditClient> =>
  Layer.effect(
    BrainFileIngestion,
    Effect.gen(function* () {
      const brain = yield* Brain
      const auditClient = yield* BrainAuditClient

      const ingestionFailure = (
        operation: string,
        cause: unknown,
      ): BrainFileIngestionError =>
        new BrainFileIngestionError({
          operation,
          message: messageFromUnknown(cause),
          cause,
        })

      /** Removes only the newly staged object and never masks primary failure. */
      const discardStagedUpload = Effect.fn(
        'BrainFileIngestion.discardStagedUpload',
      )(function* (input: {
        r2Key: string
        reason: 'duplicate' | 'upload_failed'
      }) {
        yield* Effect.tryPromise({
          try: () => env.BRAIN_FILES.delete(input.r2Key),
          catch: (cause) =>
            ingestionFailure('delete staged brain upload', cause),
        }).pipe(
          Effect.catch((failure) =>
            Effect.sync(() => {
              brainIngestionLogger.error('brain staged upload cleanup failed', {
                r2Key: input.r2Key,
                reason: input.reason,
                ...errorFields(failure),
              })
            }),
          ),
        )
      })

      const resolveAuditHost = Effect.fn('BrainFileIngestion.resolveAuditHost')(
        function* (input: { ownerUserId: string; workspaceId: string }) {
          const db = yield* Effect.tryPromise({
            try: () => getDb(env),
            catch: (cause) =>
              ingestionFailure('open workspace database', cause),
          })
          const agent = yield* Effect.tryPromise({
            try: () =>
              ensureAgentRow({
                db,
                ownerUserId: input.ownerUserId,
                workspaceId: input.workspaceId,
              }),
            catch: (cause) =>
              ingestionFailure('resolve workspace audit agent', cause),
          })
          return agent.hostName ?? agent.id
        },
      )

      const stage = Effect.fn('BrainFileIngestion.stage')(function* (input: {
        file: File
        itemId: string
        ownerUserId: string
        r2Key: string
        workspaceId: string
      }) {
        const at = yield* DateTime.now
        yield* Effect.tryPromise({
          try: () =>
            env.BRAIN_FILES.put(input.r2Key, input.file.stream(), {
              httpMetadata: {
                contentType: input.file.type || 'application/octet-stream',
                contentDisposition: buildContentDisposition(
                  'inline',
                  input.file.name,
                ),
              },
            }),
          catch: (cause) => ingestionFailure('stage brain upload', cause),
        })

        const added = yield* brain
          .addItem({
            tenantId: WorkspaceId.make(input.workspaceId),
            kind: Kind.make('file'),
            label: normalizeDownloadFilename(input.file.name),
            r2Key: input.r2Key,
            canonical: {
              type: 'file',
              value: `brain:${input.workspaceId}:${normalizeDownloadFilename(input.file.name)}`,
            },
            indexStatus: 'processing',
            origin: {
              actor: { _tag: 'Human', userId: input.ownerUserId },
              at,
            },
          })
          .pipe(
            Effect.mapError((cause) =>
              ingestionFailure('adopt staged brain upload', cause),
            ),
            Effect.tapError(() =>
              discardStagedUpload({
                r2Key: input.r2Key,
                reason: 'upload_failed',
              }),
            ),
          )

        if (added.r2Key !== input.r2Key) {
          yield* discardStagedUpload({
            r2Key: input.r2Key,
            reason: 'duplicate',
          })
        }
        return added
      })

      /** Records a terminal indexing failure without rejecting background work. */
      const persistIndexFailure = (
        input: { itemId: string; workspaceId: string },
        failure: unknown,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          brainIngestionLogger.error('brain file deferred indexing failed', {
            itemId: input.itemId,
            workspaceId: input.workspaceId,
            ...errorFields(failure),
          })

          yield* brain
            .updateIndexStatus({
              itemId: ItemId.make(input.itemId),
              tenantId: WorkspaceId.make(input.workspaceId),
              status: 'failed',
              error: messageFromUnknown(failure),
            })
            .pipe(
              Effect.asVoid,
              Effect.catch((statusFailure) =>
                Effect.sync(() => {
                  brainIngestionLogger.error(
                    'brain file failure status update failed',
                    {
                      itemId: input.itemId,
                      workspaceId: input.workspaceId,
                      ...errorFields(statusFailure),
                    },
                  )
                }),
              ),
            )
        })

      const indexAndAudit = Effect.fn('BrainFileIngestion.indexAndAudit')(
        function* (input: {
          itemId: string
          ownerUserId: string
          workspaceId: string
        }) {
          const indexed = yield* Effect.matchEffect(
            Effect.gen(function* () {
              yield* brain.updateIndexStatus({
                itemId: ItemId.make(input.itemId),
                tenantId: WorkspaceId.make(input.workspaceId),
                status: 'processing',
              })

              yield* brain.ensureIndexes()

              return yield* brain.index(
                ItemId.make(input.itemId),
                WorkspaceId.make(input.workspaceId),
              )
            }),
            {
              onFailure: (failure) =>
                persistIndexFailure(input, failure).pipe(Effect.as(null)),
              onSuccess: (item) => Effect.succeed(item),
            },
          )
          if (indexed === null) return
          if (indexed.body === undefined) {
            brainIngestionLogger.error('brain file deferred audit failed', {
              itemId: indexed.id,
              workspaceId: input.workspaceId,
              message: 'Indexed brain item has no extracted body',
            })
            return
          }
          const body = indexed.body

          yield* Effect.gen(function* () {
            const hostName = yield* resolveAuditHost(input)
            yield* auditClient.request({
              hostName,
              itemId: indexed.id,
              text: body,
              workspaceId: input.workspaceId,
            })
          }).pipe(
            Effect.catch((failure) =>
              Effect.sync(() => {
                brainIngestionLogger.error('brain file deferred audit failed', {
                  itemId: indexed.id,
                  workspaceId: input.workspaceId,
                  ...errorFields(failure),
                })
              }),
            ),
          )
        },
      )

      return BrainFileIngestion.of({ stage, indexAndAudit })
    }),
  )
