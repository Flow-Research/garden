import { and, asc, eq, inArray, ne, or } from 'drizzle-orm'
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
  /** `issue.state_reason`: `completed`, `not_planned`, `duplicate`, or null. */
  stateReason: string | null
  /** Current `issue.labels` names, after a labeled or unlabeled change. */
  labels: string[]
  /** Current `issue.assignees`, after an assigned or unassigned change. */
  assignees: { id: string; login: string }[]
  /** GitHub `sender.login`; Garden's own App bot is skipped to avoid echoes. */
  senderLogin: string | null
  /** `issue.updated_at` ms for delivery order enforcement. */
  updatedAtMs: number
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
  senderLogin: string | null
  createdAt: Date | null
  /** `comment.updated_at` ms for delivery order enforcement. */
  updatedAtMs: number
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

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((label) => {
    const name = typeof label === 'string' ? label : asRecord(label)?.name
    return typeof name === 'string' && name.length > 0 ? [name] : []
  })
}

function githubUsers(value: unknown): { id: string; login: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const user = asRecord(entry)
    const id = asNumber(user?.id)
    const login = asString(user?.login)
    return id !== null && login ? [{ id: String(id), login }] : []
  })
}

/**
 * Reads GitHub's `updated_at` as the delivery order marker.
 *
 * Why no fallback: the earlier version used `Date.now()` when `updated_at` was
 * missing or unparseable. That marker sorts after every real GitHub timestamp,
 * so one malformed delivery made every later genuine delivery in its scope
 * stale. GitHub always sends `updated_at` on issue and comment payloads, so
 * its absence means the payload is malformed and the caller rejects it with
 * 400. GitHub does not retry failed deliveries on its own; the 400 shows in the
 * App's delivery log for an operator to inspect.
 */
function updatedAtMarker(
  value: unknown,
  label: string,
): Result<number, GitHubWebhookResolveError> {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed)
    ? Result.ok(parsed)
    : Result.err(
        new GitHubWebhookResolveError({
          code: 'invalid_payload',
          message: `Webhook ${label}.updated_at is missing or not a timestamp`,
        }),
      )
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
  if (identityResult.isErr()) return Result.err(identityResult.error)

  const issue = asRecord(root.issue)
  if (!issue) return Result.ok(null)

  const action = asString(root.action) ?? ''
  const stateRaw = asString(issue.state)
  const state = stateRaw === 'open' || stateRaw === 'closed' ? stateRaw : null
  const sender = asRecord(root.sender)

  return updatedAtMarker(issue.updated_at, 'issue').map((updatedAtMs) => ({
    ...identityResult.value,
    action,
    title: asString(issue.title),
    body: typeof issue.body === 'string' ? issue.body : null,
    state,
    stateReason: asString(issue.state_reason),
    labels: labelNames(issue.labels),
    assignees: githubUsers(issue.assignees),
    senderLogin: asString(sender?.login),
    updatedAtMs,
  }))
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
  if (identityResult.isErr()) return Result.err(identityResult.error)

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

  return updatedAtMarker(comment.updated_at, 'comment').map((updatedAtMs) => ({
    ...identityResult.value,
    action: asString(root.action) ?? '',
    commentId,
    body: typeof comment.body === 'string' ? comment.body : '',
    commentHtmlUrl: asString(comment.html_url),
    githubLogin: asString(user?.login),
    githubUserId:
      githubUserIdNum !== null ? String(githubUserIdNum) : asString(user?.id),
    senderLogin: asString(sender?.login),
    createdAt: Number.isFinite(createdAtMs) ? new Date(createdAtMs) : null,
    updatedAtMs,
  }))
}

/**
 * Finds every Garden issue linked to the mirrored GitHub issue, across all
 * workspaces connected to the delivery's GitHub App installation.
 *
 * Why a list: GitHub allows one installation of an App per account, so two
 * Garden workspaces that connect the same GitHub org store the same
 * `installation_id` (the table is unique per workspace, not per installation).
 * The earlier version took `.limit(1)` with no order and so routed each
 * delivery to an arbitrary one of those workspaces. A unique `installation_id`
 * would instead make the second workspace's connect flow fail. Missing
 * installs or bindings return an empty list; the route acknowledges with 200.
 */
export async function resolveGitHubWebhookBindings(args: {
  db: Db
  target: GitHubWebhookIssueIdentity
}): Promise<GitHubWebhookBindingMatch[]> {
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

  const rows = await args.db
    .select({
      bindingId: schema.issueSourceBinding.id,
      issueId: schema.issueSourceBinding.issueId,
      workspaceId: schema.issueSourceBinding.workspaceId,
      externalId: schema.issueSourceBinding.externalId,
    })
    .from(schema.issueSourceBinding)
    .innerJoin(
      schema.githubAppInstallation,
      eq(
        schema.githubAppInstallation.workspaceId,
        schema.issueSourceBinding.workspaceId,
      ),
    )
    .where(
      and(
        eq(
          schema.githubAppInstallation.installationId,
          args.target.installationId,
        ),
        ne(schema.githubAppInstallation.status, 'disconnected'),
        eq(schema.issueSourceBinding.connectorId, 'github'),
        eq(schema.issueSourceBinding.sourceKind, 'issue'),
        identityMatch,
      ),
    )
    .orderBy(asc(schema.issueSourceBinding.id))

  return rows
}
