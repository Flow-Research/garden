import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { Result } from 'better-result'
import { ConnectorAuthError } from '../effect/errors.ts'
import {
  createGitHubInstallationAccessToken,
  GitHubAppAuthError,
} from '../github-app.ts'
import {
  mintGitHubInstallationAccessToken,
  withGitHubTokenRejectedRemintOnce,
} from './installation-auth.ts'
import { githubAuthFailureCode, githubAuthMessage } from './auth-errors.ts'

vi.mock('../github-app.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../github-app.ts')>()
  return {
    ...actual,
    createGitHubInstallationAccessToken: vi.fn(),
  }
})

const mint = vi.mocked(createGitHubInstallationAccessToken)

describe('mintGitHubInstallationAccessToken', () => {
  beforeEach(() => {
    mint.mockReset()
  })

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
  })

  it('maps mint failures to classified ConnectorAuthError', async () => {
    mint.mockResolvedValueOnce(
      Result.err<{ token: string; expiresAt: string; installationId: string }, GitHubAppAuthError>(
        new GitHubAppAuthError({
          code: 'token_request_failed',
          message: 'Bad credentials',
          status: 401,
        }),
      ),
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
      code: 'github.mint_failed',
      status: 401,
    })
    expect(error.message).toMatch(/\[github\.mint_failed\]/)
    expect(error.message).toContain('Bad credentials')
  })

  it('refuses degraded installs before calling GitHub', async () => {
    const error = await Effect.runPromise(
      mintGitHubInstallationAccessToken(
        {
          installationId: '42',
          installationStatus: 'degraded',
        },
        'github.writeIssue',
      ).pipe(Effect.flip),
    )

    expect(mint).not.toHaveBeenCalled()
    expect(error).toMatchObject({
      code: 'github.install_degraded',
      operation: 'github.writeIssue',
    })
    expect(error.message).toMatch(/\[github\.install_degraded\]/)
  })

  it('refuses empty installation ids before calling GitHub', async () => {
    const error = await Effect.runPromise(
      mintGitHubInstallationAccessToken(
        { installationId: '' },
        'github.writeIssue',
      ).pipe(Effect.flip),
    )

    expect(mint).not.toHaveBeenCalled()
    expect(error).toMatchObject({ code: 'github.install_missing' })
  })

  it('refuses disconnected installs before calling GitHub', async () => {
    const error = await Effect.runPromise(
      mintGitHubInstallationAccessToken(
        {
          installationId: '42',
          installationStatus: 'disconnected',
        },
        'github.writeIssue',
      ).pipe(Effect.flip),
    )

    expect(mint).not.toHaveBeenCalled()
    expect(error).toMatchObject({ code: 'github.install_disconnected' })
  })
})

describe('withGitHubTokenRejectedRemintOnce', () => {
  it('retries once on token_rejected then succeeds', async () => {
    let attempts = 0
    const result = await Effect.runPromise(
      withGitHubTokenRejectedRemintOnce(
        Effect.gen(function* () {
          attempts += 1
          if (attempts === 1) {
            return yield* new ConnectorAuthError({
              connectorId: 'github',
              operation: 'test',
              code: githubAuthFailureCode('token_rejected'),
              message: githubAuthMessage('token_rejected'),
              status: 401,
            })
          }
          return 'ok'
        }),
      ),
    )
    expect(result).toBe('ok')
    expect(attempts).toBe(2)
  })

  it('stops after one remint when still rejected', async () => {
    let attempts = 0
    const error = await Effect.runPromise(
      withGitHubTokenRejectedRemintOnce(
        Effect.gen(function* () {
          attempts += 1
          return yield* new ConnectorAuthError({
            connectorId: 'github',
            operation: 'test',
            code: githubAuthFailureCode('token_rejected'),
            message: githubAuthMessage('token_rejected'),
            status: 401,
          })
        }),
      ).pipe(Effect.flip),
    )
    expect(attempts).toBe(2)
    expect(error).toMatchObject({ code: 'github.token_rejected' })
  })
})
