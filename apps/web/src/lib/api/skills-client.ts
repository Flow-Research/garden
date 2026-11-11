import { Effect } from 'effect'
import { TaggedError } from 'better-result'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from 'effect/unstable/http'
import { HttpApiClient } from 'effect/unstable/httpapi'
import { SkillUnauthorizedError } from '@garden/core/skills'
import { GardenSkillsApi } from './skills-contract'

export class ClientSessionEnded extends TaggedError('ClientSessionEnded')<{
  message: string
}>() {}

export interface SkillsClientOptions {
  /** Absolute API origin. The platform adapter resolves same-origin web URLs. */
  origin: string
  workspaceId: string
  /** Local session generation, not an authentication credential. */
  sessionId: string
  fetch: typeof globalThis.fetch
  createRequestId: () => string
  onUnauthorized?: () => void
}

/**
 * Binds the existing typed read to one immutable client session. Previously the
 * browser singleton captured the first origin and mutable workspace. Hosts now
 * supply transport/credentials; no browser or service bindings enter this module.
 * See docs/decisions/2026-11-shared-client-session.md and FetchHttpClient.Fetch.
 */
export function createSkillsClient(options: SkillsClientOptions) {
  const origin = new URL(options.origin)
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !options.workspaceId.trim() ||
    !options.sessionId.trim()
  ) {
    throw new Error(
      'Skills client requires an HTTP origin, workspace and session',
    )
  }
  const scope = Object.freeze({
    origin: origin.origin,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
  })
  const lifetime = new AbortController()

  /** Invalidation ends this instance permanently, including in-flight reads. */
  function invalidate() {
    lifetime.abort(new ClientSessionEnded({ message: 'Client session ended' }))
  }

  /** Checks session lifetime after decoding too, even if transport ignores abort. */
  function listSkills(signal?: AbortSignal) {
    const requestSignal = signal
      ? AbortSignal.any([lifetime.signal, signal])
      : lifetime.signal
    const effect = Effect.gen(function* () {
      if (requestSignal.aborted) {
        return yield* Effect.fail(
          new ClientSessionEnded({ message: 'Client read cancelled' }),
        )
      }
      const client = yield* HttpApiClient.make(GardenSkillsApi, {
        baseUrl: scope.origin,
        transformClient: (client) =>
          HttpClient.mapRequest(client, (request) =>
            HttpClientRequest.setHeaders(request, {
              'X-Workspace-ID': scope.workspaceId,
              'X-Request-ID': options.createRequestId(),
            }),
          ),
      })
      const skills = yield* client.skills.list()
      if (requestSignal.aborted) {
        return yield* Effect.fail(
          new ClientSessionEnded({ message: 'Client session ended' }),
        )
      }
      if (skills.some((skill) => skill.workspace_id !== scope.workspaceId)) {
        return yield* Effect.fail(
          new ClientSessionEnded({
            message: 'Response workspace does not match client session',
          }),
        )
      }
      return skills
    }).pipe(
      Effect.tapError((error) => {
        if (!(error instanceof SkillUnauthorizedError) || requestSignal.aborted)
          return Effect.void
        return Effect.sync(() => {
          invalidate()
          options.onUnauthorized?.()
        })
      }),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, options.fetch),
    )
    return Effect.runPromise(effect, { signal: requestSignal })
  }

  return { scope, listSkills, invalidate }
}
