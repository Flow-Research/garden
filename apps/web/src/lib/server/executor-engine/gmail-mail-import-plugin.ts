import { Effect, Redacted, Schema, type Layer } from 'effect'
import type * as HttpClient from 'effect/unstable/http/HttpClient'
import {
  ConnectionName,
  definePlugin,
  IntegrationSlug,
  type ConnectionRef,
  type StorageFailure,
} from '@executor-js/sdk/core'
import { makeGmailClient, type GmailClientService } from '@garden/server/mail'

export const GOOGLE_GMAIL_INTEGRATION = IntegrationSlug.make('google_gmail')

export class GmailCredentialBridgeError extends Schema.TaggedErrorClass<GmailCredentialBridgeError>()(
  'GmailCredentialBridgeError',
  {
    reason: Schema.Literals([
      'unsupported_integration',
      'unsupported_owner',
      'credential_unavailable',
      'credential_resolution_failed',
    ]),
    message: Schema.String,
  },
) {}

interface GmailCredentialResolver {
  readonly resolveValue: (
    connection: ConnectionRef,
  ) => Effect.Effect<string | null, StorageFailure>
}

interface GmailMailImportDependencies {
  readonly resolver: GmailCredentialResolver
  readonly httpClientLayer: Layer.Layer<HttpClient.HttpClient>
}

export interface GmailMailImportExtension {
  readonly withGmailClient: <A, E, R>(
    connection: ConnectionRef,
    use: (client: GmailClientService) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<
    A,
    E | GmailCredentialBridgeError,
    Exclude<R, HttpClient.HttpClient>
  >
}

/**
 * Resolves one personal Gmail credential and destroys its request-local wrapper
 * after Gmail work completes. Executor remains the sole credential owner; this
 * bridge never stores, logs, exposes, or returns plaintext tokens.
 * Contract: installed `@executor-js/sdk/dist/plugin.d.ts` PluginCtx.
 */
const runWithResolvedGmailClient = <A, E, R>(
  dependencies: GmailMailImportDependencies,
  connection: ConnectionRef,
  use: (client: GmailClientService) => Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | GmailCredentialBridgeError,
  Exclude<R, HttpClient.HttpClient>
> =>
  Effect.gen(function* () {
    if (connection.integration !== GOOGLE_GMAIL_INTEGRATION) {
      return yield* Effect.fail(
        new GmailCredentialBridgeError({
          reason: 'unsupported_integration',
          message: 'Only the Executor Google Gmail integration is supported.',
        }),
      )
    }
    if (connection.owner !== 'user') {
      return yield* Effect.fail(
        new GmailCredentialBridgeError({
          reason: 'unsupported_owner',
          message: 'Gmail mailbox import requires a personal connection.',
        }),
      )
    }

    const value = yield* dependencies.resolver.resolveValue(connection).pipe(
      Effect.mapError(
        () =>
          new GmailCredentialBridgeError({
            reason: 'credential_resolution_failed',
            message: 'Executor could not resolve the Gmail credential.',
          }),
      ),
    )
    if (value === null || value.length === 0) {
      return yield* Effect.fail(
        new GmailCredentialBridgeError({
          reason: 'credential_unavailable',
          message: 'The Gmail connection has no available credential.',
        }),
      )
    }

    const accessToken = Redacted.make(value)
    return yield* Effect.gen(function* () {
      const client = yield* makeGmailClient(accessToken)
      return yield* use(client)
    }).pipe(
      Effect.provide(dependencies.httpClientLayer),
      Effect.ensuring(Effect.sync(() => Redacted.wipeUnsafe(accessToken))),
    )
  })

/** Creates the scoped Gmail extension used by Executor programs. */
export const makeGmailMailImportExtension = (
  dependencies: GmailMailImportDependencies,
): GmailMailImportExtension => ({
  withGmailClient: (connection, use) =>
    runWithResolvedGmailClient(dependencies, connection, use),
})

/**
 * Runs Gmail work inside one Executor credential scope. Callers receive only
 * decoded Gmail data through the client; the access token is wiped when the
 * returned Effect finishes or is interrupted.
 */
export const withExecutorGmailClient = <A, E, R>(
  extension: GmailMailImportExtension,
  connection: ConnectionRef,
  use: (client: GmailClientService) => Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | GmailCredentialBridgeError,
  Exclude<R, HttpClient.HttpClient>
> => extension.withGmailClient(connection, use)

export const gmailMailImportPlugin = definePlugin(() => ({
  id: 'gmailMailImport' as const,
  storage: () => ({}),
  extension: (ctx) =>
    makeGmailMailImportExtension({
      resolver: {
        resolveValue: (connection) => ctx.connections.resolveValue(connection),
      },
      httpClientLayer: ctx.httpClientLayer,
    }),
}))

/** Builds a personal Google Gmail connection ref without exposing addresses. */
export const gmailPersonalConnectionRef = (
  connectionName: string,
): ConnectionRef => ({
  owner: 'user',
  integration: GOOGLE_GMAIL_INTEGRATION,
  name: ConnectionName.make(connectionName),
})
