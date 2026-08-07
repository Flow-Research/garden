import { Context, Effect, Layer, Option } from 'effect'
import * as Arr from 'effect/Array'
import type { OAuthClientSummary } from '@executor-js/sdk/core'
import type { ExecutorConnectionOwner } from '@/lib/executor-contract'

/** Owner-scoped policy consumed by connection creation workflows. */
export interface ConnectionOwnershipService {
  readonly owner: ExecutorConnectionOwner
  readonly selectOAuthClient: (
    clients: readonly OAuthClientSummary[],
    supportsMethod: (client: OAuthClientSummary) => boolean,
  ) => Effect.Effect<Option.Option<OAuthClientSummary>>
}

/**
 * Keeps connection ownership policy out of HTTP and Executor adapter logic.
 * Personal connections may reuse Workspace OAuth applications, while Workspace
 * connections remain restricted to Workspace-owned applications.
 */
export class ConnectionOwnership extends Context.Service<
  ConnectionOwnership,
  ConnectionOwnershipService
>()('@garden/executor/ConnectionOwnership') {}

/** Builds request-scoped ownership policy after transport authorization. */
export const connectionOwnershipLayer = (
  owner: ExecutorConnectionOwner,
): Layer.Layer<ConnectionOwnership> =>
  Layer.sync(ConnectionOwnership, () => {
    const selectOAuthClient = Effect.fn(
      'ConnectionOwnership.selectOAuthClient',
    )((
      clients: readonly OAuthClientSummary[],
      supportsMethod: (client: OAuthClientSummary) => boolean,
    ) => {
      const compatible = Arr.filter(
        clients,
        (client) =>
          (client.owner === owner ||
            (owner === 'user' && client.owner === 'org')) &&
          supportsMethod(client),
      )
      return Effect.succeed(
        Option.orElse(
          Arr.findFirst(compatible, (client) => client.owner === owner),
          () => Arr.head(compatible),
        ),
      )
    })

    return ConnectionOwnership.of({ owner, selectOAuthClient })
  })
