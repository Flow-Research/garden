import { Result, TaggedError } from 'better-result'
import { getGitHubAppInstallation } from '@garden/connectors/github-app'
import { schema, type Db } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const GITHUB_SETUP_STATE_TTL_MS = 15 * 60 * 1000

export class GitHubInstallError extends TaggedError('GitHubInstallError')<{
  code:
    | 'github_app_not_configured'
    | 'github_installation_invalid'
    | 'github_state_invalid'
    | 'database_failed'
  message: string
}>() {}

type GitHubAppEnv = Pick<
  AppEnv,
  | 'BETTER_AUTH_SECRET'
  | 'GITHUB_CLIENT_ID'
  | 'GITHUB_APP_ID'
  | 'GITHUB_APP_PRIVATE_KEY'
>

type GitHubAppDatabase = Db

function normalizeGitHubAppEnv(env: GitHubAppEnv) {
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim()

  return {
    ...env,
    GITHUB_APP_PRIVATE_KEY: privateKey?.startsWith('"')
      ? Result.try(() => JSON.parse(privateKey) as string).unwrapOr(privateKey)
      : privateKey,
  }
}

export function resolveGitHubAppSlug(env: {
  GITHUB_APP_SLUG?: string
  GITHUB_CLIENT_ID?: string
}) {
  return env.GITHUB_APP_SLUG?.trim() || 'garden-ai-dev'
}

export function buildGitHubAppInstallUrl(args: {
  appSlug: string
  state?: string
}) {
  const url = new URL(
    `https://github.com/apps/${args.appSlug}/installations/new`,
  )
  if (args.state) url.searchParams.set('state', args.state)
  return url.toString()
}

function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)

  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string) {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '=',
  )
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function signSetupState(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(payload),
  )
  return base64Url(new Uint8Array(signature))
}

function constantTimeEquals(left: string, right: string) {
  if (left.length !== right.length) return false

  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return diff === 0
}

export async function createGitHubSetupState(args: {
  secret: string
  userId: string
  workspaceId: string
  flowId?: string | null
}) {
  const payload = base64Url(
    textEncoder.encode(
      JSON.stringify({
        userId: args.userId,
        workspaceId: args.workspaceId,
        issuedAt: Date.now(),
        ...(args.flowId ? { flowId: args.flowId } : {}),
      }),
    ),
  )
  const signature = await signSetupState(args.secret, payload)
  return `${payload}.${signature}`
}

export async function resolveGitHubSetupState(args: {
  secret: string
  state: string
}) {
  const [payload, signature] = args.state.split('.')
  if (!payload || !signature) {
    return Result.err(
      new GitHubInstallError({
        code: 'github_state_invalid',
        message: 'GitHub setup state is invalid',
      }),
    )
  }

  const expectedSignature = await signSetupState(args.secret, payload)
  if (!constantTimeEquals(expectedSignature, signature)) {
    return Result.err(
      new GitHubInstallError({
        code: 'github_state_invalid',
        message: 'GitHub setup state signature is invalid',
      }),
    )
  }

  return Result.try({
    try: () => {
      const decoded = textDecoder.decode(decodeBase64Url(payload))
      const value = JSON.parse(decoded) as {
        userId?: unknown
        workspaceId?: unknown
        issuedAt?: unknown
        flowId?: unknown
      }
      if (
        typeof value.userId !== 'string' ||
        typeof value.workspaceId !== 'string' ||
        typeof value.issuedAt !== 'number'
      ) {
        throw new Error('GitHub setup state is missing required fields')
      }
      if (Date.now() - value.issuedAt > GITHUB_SETUP_STATE_TTL_MS) {
        throw new Error('GitHub setup state expired')
      }
      return {
        userId: value.userId,
        workspaceId: value.workspaceId,
        ...(typeof value.flowId === 'string' ? { flowId: value.flowId } : {}),
      }
    },
    catch: (cause) =>
      new GitHubInstallError({
        code: 'github_state_invalid',
        message:
          cause instanceof Error
            ? cause.message
            : 'GitHub setup state is invalid',
      }),
  })
}

/**
 * Persists GitHub App install state as a workspace-scoped upsert. A retry after
 * the earlier tool-sync failure can already have a degraded row, and the old
 * select-then-insert path surfaced duplicate/laggy-read DB errors instead of
 * idempotently refreshing the installation. After this, every callback rewrites
 * the workspace row and preserves its original createdAt. References consulted:
 * better-result outcome modeling source and Drizzle/Postgres on-conflict usage.
 */
export async function completeGitHubAppInstallation(args: {
  db: GitHubAppDatabase
  env: GitHubAppEnv
  userId: string
  workspaceId: string
  installationId: string
}) {
  const installation = await getGitHubAppInstallation({
    env: normalizeGitHubAppEnv(args.env),
    installationId: args.installationId,
  })
  if (installation.isErr()) {
    return Result.err(
      new GitHubInstallError({
        code: 'github_installation_invalid',
        message: installation.error.message,
      }),
    )
  }

  const accountLogin = installation.value.account?.login
  if (!accountLogin) {
    return Result.err(
      new GitHubInstallError({
        code: 'github_installation_invalid',
        message: 'GitHub installation is missing account login',
      }),
    )
  }

  const now = new Date()
  const installationRecord = {
    workspaceId: args.workspaceId,
    installationId: args.installationId,
    accountLogin,
    repositorySelection: installation.value.repository_selection ?? 'selected',
    status: 'connected',
    connectedBy: args.userId,
    updatedAt: now,
  } satisfies typeof schema.githubAppInstallation.$inferInsert

  const result = await Result.tryPromise({
    try: async () => {
      await args.db
        .insert(schema.githubAppInstallation)
        .values(installationRecord)
        .onConflictDoUpdate({
          target: schema.githubAppInstallation.workspaceId,
          set: {
            installationId: installationRecord.installationId,
            accountLogin: installationRecord.accountLogin,
            repositorySelection: installationRecord.repositorySelection,
            status: installationRecord.status,
            connectedBy: installationRecord.connectedBy,
            updatedAt: installationRecord.updatedAt,
          },
        })
    },
    catch: (cause) =>
      new GitHubInstallError({
        code: 'database_failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to save GitHub App installation',
      }),
  })

  return result.map(() => ({ accountLogin }))
}
