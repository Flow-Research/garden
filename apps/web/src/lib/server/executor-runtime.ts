import { Effect } from 'effect'
import {
  type StorageFailure,
  Subject,
  Tenant,
  createExecutor,
  type Executor,
} from '@executor-js/sdk/core'
import { appEnv } from './env'
import { createD1ExecutorDb } from './executor-engine/d1'
import { makeR2BlobStore } from './executor-engine/r2'
import {
  makeExecutorPlugins,
  type GardenExecutorPlugins,
} from './executor-engine/plugins'

export interface ExecutorIdentity {
  readonly tenant: string
  readonly subject: string
}

export type GardenExecutor = Executor<GardenExecutorPlugins>

export interface ExecutorCatalog {
  readonly integrations: readonly {
    readonly slug: string
    readonly name: string
    readonly description: string
    readonly displayUrl?: string
    readonly family?: string
    readonly kind: string
    readonly canRemove: boolean
    readonly canRefresh: boolean
    readonly authMethods: readonly {
      readonly kind: 'none' | 'oauth' | 'apikey' | 'header'
      readonly id: string
      readonly label: string
      readonly template: string
      readonly placements?: readonly {
        readonly carrier: 'header' | 'query' | 'env'
        readonly name: string
        readonly prefix?: string
        readonly variable?: string
        readonly literal?: string
      }[]
      readonly oauth?: {
        readonly authorizationUrl?: string
        readonly tokenUrl?: string
        readonly resource?: string
        readonly scopes: readonly string[]
      }
    }[]
  }[]
  readonly connections: readonly {
    readonly owner: 'org' | 'user'
    readonly integration: string
    readonly name: string
    readonly address: string
    readonly identityLabel?: string | null
    readonly expiresAt?: number | null
    readonly lastHealth?: {
      readonly status: string
      readonly detail?: string | null
      readonly checkedAt: number
    } | null
  }[]
  readonly tools: readonly {
    readonly address: string
    readonly name: string
    readonly description: string
    readonly integration: string
    readonly connection: string
    readonly owner: 'org' | 'user'
    readonly requiresApproval: boolean
    readonly mayElicit: boolean
  }[]
}

/**
 * Acquires one tenant/member-scoped Executor directly from the public v1.5.40
 * Effect SDK. Garden owns HTTP/auth; Executor owns connector state and OAuth.
 * The SDK handle is request-scoped while D1/R2 bindings remain isolate-safe.
 */
export const executorProgram = <A, E>(
  identity: ExecutorIdentity,
  use: (executor: GardenExecutor) => Effect.Effect<A, E>,
): Effect.Effect<A, E | StorageFailure> =>
  Effect.acquireUseRelease(
    createExecutor({
      tenant: Tenant.make(identity.tenant),
      subject: Subject.make(identity.subject),
      db: ({ tables }) =>
        createD1ExecutorDb(
          appEnv.EXECUTOR_DB,
          tables,
          appEnv.EXECUTOR_BLOBS,
        ).pipe(Effect.map((database) => ({ db: database.db }))),
      blobs: makeR2BlobStore(appEnv.EXECUTOR_BLOBS),
      plugins: makeExecutorPlugins(appEnv.EXECUTOR_SECRET_KEY),
      onElicitation: () => Effect.succeed({ action: 'decline' as const }),
      oauthCallbackStateOrgSlug: identity.tenant,
    }),
    use,
    (executor) => executor.close().pipe(Effect.ignore),
  )

/** Runs one direct Executor SDK program at the Promise API-route boundary. */
export const runExecutor = <A, E>(
  identity: ExecutorIdentity,
  use: (executor: GardenExecutor) => Effect.Effect<A, E>,
): Promise<A> => Effect.runPromise(executorProgram(identity, use))

/**
 * Reads the connector catalog from the in-process public Executor SDK. Garden
 * keeps this projection transport-neutral so API routes never depend on an
 * internal Worker binding or Executor's unpublished HTTP host.
 */
export const loadExecutorCatalog = Effect.fn('ExecutorRuntime.loadCatalog')(
  function* (identity: ExecutorIdentity) {
    return yield* executorProgram(identity, (executor) =>
      Effect.all({
        integrations: executor.integrations.list(),
        connections: executor.connections.list(),
        tools: executor.tools.list({
          includeBlocked: true,
          includeAnnotations: true,
        }),
      }).pipe(
        Effect.map(
          ({ integrations, connections, tools }): ExecutorCatalog => ({
            integrations: integrations.map((integration) => ({
              slug: String(integration.slug),
              name: integration.name,
              description: integration.description,
              displayUrl: integration.displayUrl,
              family: integration.family,
              kind: integration.kind,
              canRemove: integration.canRemove,
              canRefresh: integration.canRefresh,
              authMethods: integration.authMethods.map((method) => ({
                kind: method.kind,
                id: method.id,
                label: method.label,
                template: method.template,
                placements: method.placements,
                ...(method.oauth === undefined
                  ? {}
                  : {
                      oauth: {
                        authorizationUrl: method.oauth.authorizationUrl,
                        tokenUrl: method.oauth.tokenUrl,
                        resource: method.oauth.resource ?? undefined,
                        scopes: method.oauth.scopes ?? [],
                      },
                    }),
              })),
            })),
            connections: connections.map((connection) => ({
              owner: connection.owner,
              integration: String(connection.integration),
              name: String(connection.name),
              address: String(connection.address),
              identityLabel: connection.identityLabel,
              expiresAt: connection.expiresAt,
              lastHealth: connection.lastHealth,
            })),
            tools: tools.map((tool) => ({
              address: String(tool.address),
              name: String(tool.name),
              description: tool.description,
              integration: String(tool.integration),
              connection: String(tool.connection),
              owner: tool.owner,
              requiresApproval: tool.annotations?.requiresApproval === true,
              mayElicit: tool.annotations?.mayElicit === true,
            })),
          }),
        ),
      ),
    )
  },
)
