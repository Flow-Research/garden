import { and, eq, inArray, or } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { schema, type Db } from '@/lib/server/db'

export class GitHubWebhookResolveError extends TaggedError(
  'GitHubWebhookResolveError',
)<{
  code: 'invalid_payload'
  message: string
}>() {}

export type GitHubWebhookIssueTarget = {
  installationId: string
  owner: string
  repo: string
  issueNumber: number
  htmlUrl: string | null
  action: string
  title: string | null
  body: string | null
  state: 'open' | 'closed' | null
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

/**
 * Extracts installation + issue identity from a verified GitHub webhook JSON
 * body. Non-issue deliveries return null (caller acknowledges and skips).
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

  const issue = asRecord(root.issue)
  if (!issue) return Result.ok(null)

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
  const action = asString(root.action) ?? ''
  const stateRaw = asString(issue.state)
  const state =
    stateRaw === 'open' || stateRaw === 'closed' ? stateRaw : null

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
    action,
    title: asString(issue.title),
    body: typeof issue.body === 'string' ? issue.body : null,
    state,
  })
}

/**
 * Maps a GitHub App installation id → workspace, then finds an issue source
 * binding for the mirrored GitHub issue. Missing install or binding is not an
 * error — those deliveries are ignored with 200 (#161 step 3).
 */
export async function resolveGitHubWebhookBinding(args: {
  db: Db
  target: GitHubWebhookIssueTarget
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
