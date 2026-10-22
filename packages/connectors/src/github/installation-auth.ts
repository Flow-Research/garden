import { Effect } from 'effect'
import { createGitHubInstallationAccessToken } from '../github-app.ts'
import {
  connectorAuthErrorFromMintFailure,
  githubInstallationHealthError,
  isGitHubTokenRejectedError,
} from './auth-errors.ts'
import type { GitHubAppConfigShape } from './rest-client.ts'

/**
 * Shared Effect mint for native REST and hosted MCP. Refuses missing /
 * disconnected / degraded installs before calling GitHub (#163 phase 3), then
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

  const credential = yield* Effect.promise(() =>
    createGitHubInstallationAccessToken({
      env: {
        GITHUB_APP_ID: config.appId,
        GITHUB_CLIENT_ID: config.clientId,
        GITHUB_APP_PRIVATE_KEY: config.privateKey,
      },
      installationId: config.installationId,
    }),
  )
  if (credential.isErr()) {
    return yield* connectorAuthErrorFromMintFailure({
      operation,
      error: credential.error,
    })
  }
  return credential.value
})

/**
 * On `github.token_rejected` (HTTP 401 after a successful mint), remint and
 * retry the operation once. A second rejection surfaces as the classified
 * auth error with no further loops (#163 phase 4). Mint lives inside `effect`
 * so the retry picks up a fresh installation token.
 */
export function withGitHubTokenRejectedRemintOnce<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.retry(effect, {
    times: 1,
    while: (error) => isGitHubTokenRejectedError(error),
  })
}
