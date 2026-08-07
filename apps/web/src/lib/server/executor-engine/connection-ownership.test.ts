import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import {
  IntegrationSlug,
  OAuthClientSlug,
  type OAuthClientSummary,
} from '@executor-js/sdk/core'
import type { ExecutorConnectionOwner } from '@/lib/executor-contract'
import {
  ConnectionOwnership,
  connectionOwnershipLayer,
} from './connection-ownership'

/** Creates public OAuth client metadata without introducing test secrets. */
const oauthClient = (
  owner: ExecutorConnectionOwner,
  slug: string,
): OAuthClientSummary => ({
  owner,
  slug: OAuthClientSlug.make(slug),
  grant: 'authorization_code',
  authorizationUrl: `https://${slug}.example.com/authorize`,
  tokenUrl: `https://${slug}.example.com/token`,
  clientId: `${slug}-client`,
  origin: {
    kind: 'manual',
    integration: IntegrationSlug.make('example'),
  },
})

const workspaceClient = oauthClient('org', 'workspace')
const personalClient = oauthClient('user', 'personal')
const incompatibleClient = oauthClient('org', 'incompatible')

/** Runs ownership policy with its request-scoped production layer. */
const selectClient = (
  owner: ExecutorConnectionOwner,
  clients: readonly OAuthClientSummary[],
) =>
  Effect.gen(function* () {
    const ownership = yield* ConnectionOwnership
    const selected = yield* ownership.selectOAuthClient(
      clients,
      (client) => client.slug !== incompatibleClient.slug,
    )
    return {
      owner: ownership.owner,
      selected: Option.getOrNull(selected),
    }
  }).pipe(Effect.provide(connectionOwnershipLayer(owner)))

describe('ConnectionOwnership', () => {
  it.effect(
    'prefers a Personal OAuth client over a compatible Workspace client',
    () =>
      Effect.gen(function* () {
        const result = yield* selectClient('user', [
          workspaceClient,
          personalClient,
        ])

        expect(result.owner).toBe('user')
        expect(result.selected).toBe(personalClient)
      }),
  )

  it.effect(
    'allows Personal connections to reuse a compatible Workspace client',
    () =>
      Effect.gen(function* () {
        const result = yield* selectClient('user', [
          incompatibleClient,
          workspaceClient,
        ])

        expect(result.selected).toBe(workspaceClient)
      }),
  )

  it.effect('prevents Workspace connections from using Personal clients', () =>
    Effect.gen(function* () {
      const result = yield* selectClient('org', [personalClient])

      expect(result.owner).toBe('org')
      expect(result.selected).toBeNull()
    }),
  )
})
