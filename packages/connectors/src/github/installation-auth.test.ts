import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { ConnectorAuthError } from '../effect/errors.ts'
import { mintGitHubInstallationAccessToken } from './installation-auth.ts'

vi.mock('../github-app.ts', () => ({
  createGitHubInstallationAccessToken: vi.fn(),
}))

import { createGitHubInstallationAccessToken } from '../github-app.ts'
import { Result } from 'better-result'

const mint = createGitHubInstallationAccessToken as unknown as ReturnType<
  typeof vi.fn
>

describe('mintGitHubInstallationAccessToken', () => {
  it('returns the shared credential shape on success', async () => {
    mint.mockResolvedValueOnce(
      Result.ok({
        token: 'ghs_ok',
        expiresAt: '2026-10-22T12:00:00Z',
        installationId: '42',
      }),
    )

    const credential = await Effect.runPromise(
      mintGitHubInstallationAccessToken(
        {
          installationId: '42',
          appId: '1',
          privateKey: 'pem',
        },
        'github.writeIssue',
      ),
    )

    expect(credential).toEqual({
      token: 'ghs_ok',
      expiresAt: '2026-10-22T12:00:00Z',
      installationId: '42',
    })
    expect(mint).toHaveBeenCalledWith({
      env: {
        GITHUB_APP_ID: '1',
        GITHUB_CLIENT_ID: undefined,
        GITHUB_APP_PRIVATE_KEY: 'pem',
      },
      installationId: '42',
    })
  })

  it('maps mint failures to ConnectorAuthError', async () => {
    mint.mockResolvedValueOnce(
      Result.err({
        code: 'token_request_failed',
        message: 'Bad credentials',
        status: 401,
      }),
    )

    const error = await Effect.runPromise(
      mintGitHubInstallationAccessToken(
        { installationId: '42' },
        'github.mcp.listTools',
      ).pipe(Effect.flip),
    )

    expect(error).toBeInstanceOf(ConnectorAuthError)
    expect(error).toMatchObject({
      connectorId: 'github',
      operation: 'github.mcp.listTools',
      message: 'Bad credentials',
      status: 401,
    })
  })
})
