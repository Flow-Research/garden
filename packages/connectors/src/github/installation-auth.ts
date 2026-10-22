import { Effect } from 'effect'
import { createGitHubInstallationAccessToken } from '../github-app.ts'
import { connectorAuthErrorFromMintFailure } from './auth-errors.ts'
import type { GitHubAppConfigShape } from './rest-client.ts'

/**
 * Shared Effect mint for native REST and hosted MCP. Mint failures become
 * classified ConnectorAuthError messages (phase 2 / #163) instead of raw
 * upstream "Bad credentials".
 */
export const mintGitHubInstallationAccessToken = Effect.fn(
  'GitHubInstallationAuth.mint',
)(function* (config: GitHubAppConfigShape, operation: string) {
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
