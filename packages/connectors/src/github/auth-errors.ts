import {
  ConnectorAuthError,
  ConnectorHttpError,
  ConnectorPermissionError,
  type ConnectorError,
} from '../effect/errors.ts'
import type { GitHubAppAuthError } from '../github-app.ts'

/**
 * Stable GitHub App auth failure codes for #163. Phase 2 surfaces these in
 * connector errors so agents/users get actionable hints instead of opaque
 * "Bad credentials". `install_*` are reserved for the health gate (phase 3).
 */
export type GitHubAuthFailureCode =
  | 'install_missing'
  | 'install_disconnected'
  | 'mint_failed'
  | 'token_rejected'
  | 'insufficient_permission'

const GITHUB_AUTH_HINTS: Record<GitHubAuthFailureCode, string> = {
  install_missing:
    'No GitHub App installation is linked to this workspace. Connect GitHub under Connections, then retry.',
  install_disconnected:
    'The GitHub App installation for this workspace is disconnected. Repair or reconnect it under Connections, then retry.',
  mint_failed:
    'Could not mint a GitHub App installation token for this workspace. Check App credentials and the installation, or reconnect under Connections.',
  token_rejected:
    'GitHub rejected this workspace installation token. Reconnect the GitHub App under Connections, then retry. Do not invent a personal access token.',
  insufficient_permission:
    'GitHub denied this operation (missing permission or repository access). Check App permissions and repository selection under Connections, then retry.',
}

export function githubAuthFailureCode(code: GitHubAuthFailureCode) {
  return `github.${code}` as const
}

/**
 * Builds the agent-facing message. Keeps a stable `[github.code]` prefix so
 * transcripts stay greppable while the sentence tells the user what to do.
 */
export function githubAuthMessage(
  code: GitHubAuthFailureCode,
  detail?: string | null,
) {
  const hint = GITHUB_AUTH_HINTS[code]
  const trimmed = detail?.trim()
  if (!trimmed || trimmed === hint) {
    return `[github.${code}] ${hint}`
  }
  return `[github.${code}] ${hint} Upstream: ${trimmed}`
}

/**
 * Classifies mint-path failures from createGitHubInstallationAccessToken /
 * JWT setup. Empty installation id is treated as install_missing; everything
 * else on the mint path is mint_failed (including upstream "Bad credentials").
 */
export function classifyGitHubMintFailure(error: GitHubAppAuthError): {
  code: GitHubAuthFailureCode
  message: string
  status?: number
  connectorCode: string
} {
  const installMissing =
    error.code === 'missing_config' &&
    /installation id/i.test(error.message)

  const code: GitHubAuthFailureCode = installMissing
    ? 'install_missing'
    : 'mint_failed'

  return {
    code,
    connectorCode: githubAuthFailureCode(code),
    message: githubAuthMessage(code, error.message),
    status: error.status,
  }
}

/**
 * Maps GitHub REST/MCP HTTP failures into auth, permission, or generic HTTP
 * connector errors with classified messages.
 */
export function connectorErrorFromGitHubHttp(args: {
  operation: string
  status: number
  bodyText?: string | null
  cause?: unknown
}): ConnectorError {
  const detail = args.bodyText?.trim() || null

  if (args.status === 401) {
    return new ConnectorAuthError({
      connectorId: 'github',
      operation: args.operation,
      code: githubAuthFailureCode('token_rejected'),
      message: githubAuthMessage('token_rejected', detail),
      status: args.status,
      cause: args.cause,
    })
  }

  if (args.status === 403) {
    return new ConnectorPermissionError({
      connectorId: 'github',
      operation: args.operation,
      code: githubAuthFailureCode('insufficient_permission'),
      message: githubAuthMessage('insufficient_permission', detail),
      status: args.status,
      cause: args.cause,
    })
  }

  return new ConnectorHttpError({
    connectorId: 'github',
    operation: args.operation,
    message:
      detail ||
      `GitHub API rejected the request (${args.status}).`,
    status: args.status,
    cause: args.cause,
  })
}

export function connectorAuthErrorFromMintFailure(args: {
  operation: string
  error: GitHubAppAuthError
}) {
  const classified = classifyGitHubMintFailure(args.error)
  return new ConnectorAuthError({
    connectorId: 'github',
    operation: args.operation,
    code: classified.connectorCode,
    message: classified.message,
    status: classified.status,
  })
}
