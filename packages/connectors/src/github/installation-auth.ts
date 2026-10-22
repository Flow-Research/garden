import { Effect } from 'effect'
import { createGitHubInstallationAccessToken } from '../github-app.ts'
import {
  connectorAuthErrorFromMintFailure,
  githubInstallationHealthError,
} from './auth-errors.ts'
import type { GitHubAppConfigShape } from './rest-client.ts'

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
