import { Effect } from 'effect'
import { ConnectorAuthError } from '../effect/errors.ts'
import { createGitHubInstallationAccessToken } from '../github-app.ts'
import type { GitHubAppConfigShape } from './rest-client.ts'

/**
 * Shared Effect mint for native REST and hosted MCP. Both stacks previously
 * inlined the same createGitHubInstallationAccessToken + ConnectorAuthError
 * mapping and only kept the token string. One helper is the installation-auth
 * boundary for #163 phase 1.
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
    return yield* new ConnectorAuthError({
      connectorId: 'github',
      operation,
      message: credential.error.message,
      status: credential.error.status,
    })
  }
  return credential.value
})
