import { describe, expect, it } from 'vitest'
import {
  ConnectorAuthError,
  ConnectorHttpError,
  ConnectorPermissionError,
} from '../effect/errors.ts'
import { GitHubAppAuthError } from '../github-app.ts'
import {
  classifyGitHubMintFailure,
  connectorAuthErrorFromMintFailure,
  connectorErrorFromGitHubHttp,
  githubAuthMessage,
  githubInstallationHealthError,
  isGitHubTokenRejectedError,
} from './auth-errors.ts'

describe('githubAuthMessage', () => {
  it('prefixes a stable code and keeps the reconnect hint', () => {
    expect(githubAuthMessage('token_rejected')).toMatch(
      /^\[github\.token_rejected\] /,
    )
    expect(githubAuthMessage('token_rejected')).toMatch(/Reconnect/i)
    expect(githubAuthMessage('token_rejected', 'Bad credentials')).toContain(
      'Upstream: Bad credentials',
    )
  })
})

describe('githubInstallationHealthError', () => {
  it('returns install_missing for an empty installation id', () => {
    const error = githubInstallationHealthError({
      operation: 'github.writeIssue',
      installationId: '  ',
    })
    expect(error).toBeInstanceOf(ConnectorAuthError)
    expect(error).toMatchObject({
      code: 'github.install_missing',
      operation: 'github.writeIssue',
    })
    expect(error?.message).toMatch(/\[github\.install_missing\]/)
  })

  it('returns install_disconnected for disconnected status', () => {
    const error = githubInstallationHealthError({
      operation: 'github.writeIssue',
      installationId: '42',
      installationStatus: 'disconnected',
    })
    expect(error?.code).toBe('github.install_disconnected')
    expect(error?.message).toMatch(/disconnected/i)
  })

  it('returns install_degraded for degraded status', () => {
    const error = githubInstallationHealthError({
      operation: 'github.writeIssue',
      installationId: '42',
      installationStatus: 'degraded',
    })
    expect(error?.code).toBe('github.install_degraded')
    expect(error?.message).toMatch(/repair/i)
  })

  it('returns null for connected or omitted status', () => {
    expect(
      githubInstallationHealthError({
        operation: 'github.writeIssue',
        installationId: '42',
      }),
    ).toBeNull()
    expect(
      githubInstallationHealthError({
        operation: 'github.writeIssue',
        installationId: '42',
        installationStatus: 'connected',
      }),
    ).toBeNull()
  })
})

describe('classifyGitHubMintFailure', () => {
  it('maps empty installation id to install_missing', () => {
    const classified = classifyGitHubMintFailure(
      new GitHubAppAuthError({
        code: 'missing_config',
        message: 'GitHub installation id is required',
      }),
    )
    expect(classified.code).toBe('install_missing')
    expect(classified.connectorCode).toBe('github.install_missing')
    expect(classified.message).toMatch(/\[github\.install_missing\]/)
  })

  it('maps token mint 401 Bad credentials to mint_failed', () => {
    const classified = classifyGitHubMintFailure(
      new GitHubAppAuthError({
        code: 'token_request_failed',
        status: 401,
        message: 'Bad credentials',
      }),
    )
    expect(classified.code).toBe('mint_failed')
    expect(classified.message).toMatch(/\[github\.mint_failed\]/)
    expect(classified.message).toContain('Bad credentials')
    expect(classified.status).toBe(401)
  })
})

describe('connectorAuthErrorFromMintFailure', () => {
  it('builds a ConnectorAuthError with the classified code', () => {
    const error = connectorAuthErrorFromMintFailure({
      operation: 'github.writeIssue',
      error: new GitHubAppAuthError({
        code: 'token_request_failed',
        status: 401,
        message: 'Bad credentials',
      }),
    })
    expect(error).toBeInstanceOf(ConnectorAuthError)
    expect(error).toMatchObject({
      connectorId: 'github',
      operation: 'github.writeIssue',
      code: 'github.mint_failed',
      status: 401,
    })
    expect(error.message).toMatch(/\[github\.mint_failed\]/)
  })
})

describe('isGitHubTokenRejectedError', () => {
  it('matches only token_rejected auth errors', () => {
    const rejected = connectorErrorFromGitHubHttp({
      operation: 'github.writeIssue',
      status: 401,
    })
    const permission = connectorErrorFromGitHubHttp({
      operation: 'github.writeIssue',
      status: 403,
    })
    expect(isGitHubTokenRejectedError(rejected)).toBe(true)
    expect(isGitHubTokenRejectedError(permission)).toBe(false)
    expect(isGitHubTokenRejectedError(new Error('nope'))).toBe(false)
  })
})

describe('connectorErrorFromGitHubHttp', () => {
  it('maps 401 to token_rejected auth errors', () => {
    const error = connectorErrorFromGitHubHttp({
      operation: 'github.writeIssue',
      status: 401,
      bodyText: 'Bad credentials',
    })
    expect(error).toBeInstanceOf(ConnectorAuthError)
    expect(error).toMatchObject({
      code: 'github.token_rejected',
      status: 401,
    })
    expect(error.message).toMatch(/\[github\.token_rejected\]/)
    expect(error.message).toContain('Bad credentials')
  })

  it('maps 403 to insufficient_permission', () => {
    const error = connectorErrorFromGitHubHttp({
      operation: 'github.writeIssue',
      status: 403,
      bodyText: 'Resource not accessible by integration',
    })
    expect(error).toBeInstanceOf(ConnectorPermissionError)
    expect(error).toMatchObject({
      code: 'github.insufficient_permission',
      status: 403,
    })
    expect(error.message).toMatch(/\[github\.insufficient_permission\]/)
  })

  it('keeps other statuses as ConnectorHttpError', () => {
    const error = connectorErrorFromGitHubHttp({
      operation: 'github.writeIssue',
      status: 500,
      bodyText: 'boom',
    })
    expect(error).toBeInstanceOf(ConnectorHttpError)
    expect(error.message).toBe('boom')
    expect(error.status).toBe(500)
  })
})
