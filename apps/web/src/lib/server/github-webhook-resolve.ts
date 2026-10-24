import { and, eq, inArray, or } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { schema, type Db } from '@/lib/server/db'

export class GitHubWebhookResolveError extends TaggedError(
  'GitHubWebhookResolveError',
)<{
  code: 'invalid_payload'
  message: string
}>() {}

export type GitHubWebhookIssueIdentity = {
  installationId: string
  owner: string
  repo: string
  issueNumber: number
  htmlUrl: string | null
}

export type GitHubWebhookIssueTarget = GitHubWebhookIssueIdentity & {
  action: string
  title: string | null
  body: string | null
  state: 'open' | 'closed' | null
  /** GitHub `sender.type` — Bot deliveries are skipped on apply to avoid echoes. */
  senderType: string | null
}

/**
 * Parsed `issue_comment` delivery. Binding uses the parent issue identity;
 * upsert uses `commentId` as `issue_comment.external_comment_id`.
 */
export type GitHubWebhookCommentTarget = GitHubWebhookIssueIdentity & {
  action: string
  commentId: string
  body: string
  commentHtmlUrl: string | null
  githubLogin: string | null
  githubUserId: string | null
  senderType: string | null
  createdAt: Date | null
}

export type GitHubWebhookBindingMatch = {
  workspaceId: string
  issueId: string
  bindingId: string
  externalId: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Canonical + accepted alternate external ids for a GitHub issue binding
 * (#161). Primary form matches the issue brief: `owner/repo/issues/<n>`.
 */
export function githubIssueExternalIdCandidates(args: {
  owner: string
  repo: string
  issueNumber: number
  htmlUrl?: string | null
}): string[] {
  const canonical = `${args.owner}/${args.repo}/issues/${args.issueNumber}`
  const shorthand = `${args.owner}/${args.repo}#${args.issueNumber}`
  const htmlUrl = args.htmlUrl?.trim() || null
  return [...new Set([canonical, shorthand, ...(htmlUrl ? [htmlUrl] : [])])]
}

function parseIssueIdentity(
  root: Record<string, unknown>,
): Result<GitHubWebhookIssueIdentity, GitHubWebhookResolveError> | null {
  const issue = asRecord(root.issue)
  if (!issue) return null

  const installation = asRecord(root.installation)
  const repository = asRecord(root.repository)
  const ownerLogin =
    asString(asRecord(repository?.owner)?.login) ??
    asString(asRecord(repository?.owner)?.name)
  const repoName = asString(repository?.name)
  const fullName = asString(repository?.full_name)
  const [fullOwner, fullRepo] = fullName?.split('/') ?? []

  const owner = ownerLogin ?? fullOwner ?? null
  const repo = repoName ?? fullRepo ?? null
  const installationId = asNumber(installation?.id)
  const issueNumber = asNumber(issue.number)

  if (!owner || !repo || installationId === null || issueNumber === null) {
    return Result.err(
      new GitHubWebhookResolveError({
        code: 'invalid_payload',
        message:
          'Webhook issue event is missing installation, repository, or issue number',
      }),
    )
  }

  return Result.ok({
    installationId: String(installationId),
    owner,
    repo,
    issueNumber,
    htmlUrl: asString(issue.html_url),
  })
}

/**
 * Extracts installation + issue identity from a verified GitHub webhook JSON
 * body. Non-issue deliveries return null (caller acknowledges and skips).
 * `issue_comment` payloads also carry an issue object — those return null here
 * so the comment parser owns that event type.
 */
export function parseGitHubWebhookIssueTarget(
  payload: unknown,
): Result<GitHubWebhookIssueTarget | null, GitHubWebhookResolveError> {
  const root = asRecord(payload)
  if (!root) {
    return Result.err(
      new GitHubWebhookResolveError({
        code: 'invalid_payload',
        message: 'Webhook body must be a JSON object',
      }),
    )
  }

  // issue_comment deliveries include `issue` + `comment`; do not treat as issues.*.
  if (asRecord(root.comment)) return Result.ok(null)

  const identityResult = parseIssueIdentity(root)
  if (identityResult === null) return Result.ok(null)
  if (identityResult.isErr()) return identityResult

  const issue = asRecord(root.issue)
  if (!issue) return Result.ok(null)

  const action = asString(root.action) ?? ''
  const stateRaw = asString(issue.state)
  const state =
    stateRaw === 'open' || stateRaw === 'closed' ? stateRaw : null
  const sender = asRecord(root.sender)

  return Result.ok({
    ...identityResult.value,
    action,
    title: asString(issue.title),
    body: typeof issue.body === 'string' ? issue.body : null,
    state,
    senderType: asString(sender?.type),
  })
}

/**
 * Extracts a GitHub issue_comment delivery. Returns null when `comment` is
 * absent (caller acknowledges and skips).
 */
export function parseGitHubWebhookCommentTarget(
  payload: unknown,
): Result<GitHubWebhookCommentTarget | null, GitHubWebhookResolveError> {
  const root = asRecord(payload)
  if (!root) {
    return Result.err(
      new GitHubWebhookResolveError({
        code: 'invalid_payload',
        message: 'Webhook body must be a JSON object',
      }),
    )
  }

  const comment = asRecord(root.comment)
  if (!comment) return Result.ok(null)

  const identityResult = parseIssueIdentity(root)
  if (identityResult === null) {
    return Result.err(
      new GitHubWebhookResolveError({
        code: 'invalid_payload',
        message: 'Webhook issue_comment event is missing parent issue',
      }),
    )
  }
  if (identityResult.isErr()) return identityResult

  const commentIdNum = asNumber(comment.id)
  const commentId =
    commentIdNum !== null ? String(commentIdNum) : asString(comment.id)
  if (!commentId) {
    return Result.err(
      new GitHubWebhookResolveError({
        code: 'invalid_payload',
        message: 'Webhook issue_comment event is missing comment id',
      }),
    )
  }

  const user = asRecord(comment.user)
  const sender = asRecord(root.sender)
  const createdAtRaw = asString(comment.created_at)
  const createdAtMs = createdAtRaw ? Date.parse(createdAtRaw) : Number.NaN
  const githubUserIdNum = asNumber(user?.id)

  return Result.ok({
    ...identityResult.value,
    action: asString(root.action) ?? '',
    commentId,
    body: typeof comment.body === 'string' ? comment.body : '',
    commentHtmlUrl: asString(comment.html_url),
    githubLogin: asString(user?.login),
    githubUserId:
      githubUserIdNum !== null ? String(githubUserIdNum) : asString(user?.id),
    senderType: asString(sender?.type) ?? asString(user?.type),
    createdAt: Number.isFinite(createdAtMs) ? new Date(createdAtMs) : null,
  })
}

/**
 * Maps a GitHub App installation id → workspace, then finds an issue source
 * binding for the mirrored GitHub issue. Missing install or binding is not an
 * error — those deliveries are ignored with 200 (#161 step 3).
 */
export async function resolveGitHubWebhookBinding(args: {
  db: Db
  target: GitHubWebhookIssueIdentity
}): Promise<Result<GitHubWebhookBindingMatch | null, never>> {
  const [installation] = await args.db
    .select({
      workspaceId: schema.githubAppInstallation.workspaceId,
      status: schema.githubAppInstallation.status,
    })
    .from(schema.githubAppInstallation)
    .where(
      eq(
        schema.githubAppInstallation.installationId,
        args.target.installationId,
      ),
    )
    .limit(1)

  if (!installation || installation.status === 'disconnected') {
    return Result.ok(null)
  }

  const externalIds = githubIssueExternalIdCandidates({
    owner: args.target.owner,
    repo: args.target.repo,
    issueNumber: args.target.issueNumber,
    htmlUrl: args.target.htmlUrl,
  })

  const identityMatch = args.target.htmlUrl
    ? or(
        inArray(schema.issueSourceBinding.externalId, externalIds),
        eq(schema.issueSourceBinding.externalUrl, args.target.htmlUrl),
      )
    : inArray(schema.issueSourceBinding.externalId, externalIds)

  const [binding] = await args.db
    .select({
      id: schema.issueSourceBinding.id,
      issueId: schema.issueSourceBinding.issueId,
      workspaceId: schema.issueSourceBinding.workspaceId,
      externalId: schema.issueSourceBinding.externalId,
    })
    .from(schema.issueSourceBinding)
    .where(
      and(
        eq(schema.issueSourceBinding.workspaceId, installation.workspaceId),
        eq(schema.issueSourceBinding.connectorId, 'github'),
        eq(schema.issueSourceBinding.sourceKind, 'issue'),
        identityMatch,
      ),
    )
    .limit(1)

  if (!binding) return Result.ok(null)

  return Result.ok({
    workspaceId: binding.workspaceId,
    issueId: binding.issueId,
    bindingId: binding.id,
    externalId: binding.externalId,
  })
}
