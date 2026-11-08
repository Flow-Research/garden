import { Effect } from 'effect'
import {
  createGitHubInstallationAccessToken,
  normalizeGitHubAppPrivateKey,
  type GitHubInstallationAccessToken,
} from '../github-app.ts'
import {
  connectorAuthErrorFromMintFailure,
  githubInstallationHealthError,
  isGitHubTokenRejectedError,
} from './auth-errors.ts'
import type { GitHubAppConfigShape } from './rest-client.ts'

/** Drop cached tokens this far before GitHub's expires_at (#163 phase 6). */
const TOKEN_CACHE_SKEW_MS = 2 * 60 * 1000

const installationTokenCache = new Map<string, GitHubInstallationAccessToken>()

/**
 * Clears a cached installation token. Used after token_rejected so remint-once
 * does not reuse the rejected credential, and by tests.
 */
export function invalidateGitHubInstallationTokenCache(installationId: string) {
  installationTokenCache.delete(installationId.trim())
}

/** Test helper: drop every cached installation token. */
export function clearGitHubInstallationTokenCache() {
  installationTokenCache.clear()
}

function readCachedInstallationToken(
  installationId: string,
  now = Date.now(),
): GitHubInstallationAccessToken | null {
  const cached = installationTokenCache.get(installationId)
  if (!cached) return null
  const expiresAtMs = Date.parse(cached.expiresAt)
  if (
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs - TOKEN_CACHE_SKEW_MS <= now
  ) {
    installationTokenCache.delete(installationId)
    return null
  }
  return cached
}

/**
 * Shared Effect mint for native REST and hosted MCP. Refuses missing /
 * disconnected / degraded installs before calling GitHub (#163 phase 3),
 * reuses short-lived tokens until expires_at minus skew (phase 6), then
 * classifies mint failures (phase 2).
 */
export const mintGitHubInstallationAccessToken = Effect.fn(
  'GitHubInstallationAuth.mint',
)(function* (config: GitHubAppConfigShape, operation: string) {
  const healthError = githubInstallationHealthError({
    operation,
    installationId: config.installationId,
    installationStatus: config.installationStatus,
  })
  if (healthError) return yield* healthError

  const installationId = config.installationId.trim()
  const cached = readCachedInstallationToken(installationId)
  if (cached) return cached

  const credential = yield* Effect.promise(() =>
    createGitHubInstallationAccessToken({
      env: {
        GITHUB_APP_ID: config.appId,
        GITHUB_CLIENT_ID: config.clientId,
        GITHUB_APP_PRIVATE_KEY: normalizeGitHubAppPrivateKey(config.privateKey),
      },
      installationId,
    }),
  )
  if (credential.isErr()) {
    return yield* connectorAuthErrorFromMintFailure({
      operation,
      error: credential.error,
    })
  }

  installationTokenCache.set(installationId, credential.value)
  return credential.value
})

/**
 * On `github.token_rejected` (HTTP 401 after a successful mint), drop any
 * cached token for the installation, remint, and retry once. A second
 * rejection surfaces as the classified auth error with no further loops
 * (#163 phase 4 + phase 6 cache).
 */
export function withGitHubTokenRejectedRemintOnce<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  installationId: string,
): Effect.Effect<A, E, R> {
  return Effect.retry(
    effect.pipe(
      Effect.tapError((error) => {
        if (isGitHubTokenRejectedError(error)) {
          invalidateGitHubInstallationTokenCache(installationId)
        }
        return Effect.void
      }),
    ),
    {
      times: 1,
      while: (error) => isGitHubTokenRejectedError(error),
    },
  )
}
