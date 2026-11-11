import { and, eq } from 'drizzle-orm'
import { Result } from 'better-result'
import { z } from 'zod'
import type { IssueStatus } from '@garden/core/types/issue'
import { schema, type Db } from '@/lib/server/db'
import { resolveTeamRepositoryLinks } from './github-issue-sync'
import type { GitHubWebhookIssueApplyOutcome } from './github-webhook-apply'
import type { GitHubWebhookTx } from './github-webhook-delivery'
import {
  GitHubWebhookResolveError,
  resolveGitHubWebhookBindings,
  type GitHubWebhookBindingMatch,
} from './github-webhook-resolve'

/**
 * The `pull_request` webhook fields Garden reads. Parsed at the route
 * boundary; everything past it trusts this shape.
 * https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
 */
export const githubPullRequestWebhookSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }),
  repository: z.object({
    id: z.number(),
    full_name: z.string(),
  }),
  pull_request: z.object({
    number: z.number(),
    html_url: z.string(),
    body: z.string().nullable(),
    draft: z.boolean().default(false),
    merged: z.boolean().nullable().default(false),
    updated_at: z
      .string()
      .refine((value) => Number.isFinite(Date.parse(value))),
  }),
  sender: z.object({ login: z.string() }).nullable().optional(),
})

/** What a pull request event says about the work on its linked issues. */
export type PullRequestSignal =
  | 'opened_draft'
  | 'opened_ready'
  | 'converted_to_draft'
  | 'merged'
  | 'closed_unmerged'

export type GitHubPullRequestTarget = {
  installationId: string
  githubRepoId: number
  fullName: string
  number: number
  htmlUrl: string
  senderLogin: string | null
  signal: PullRequestSignal
  /** Issue numbers in this repository the body closes. */
  linkedIssueNumbers: number[]
  updatedAtMs: number
}

/** Maps a `pull_request` action onto a signal; other actions are ignored. */
function pullRequestSignal(
  pr: z.infer<typeof githubPullRequestWebhookSchema>,
): PullRequestSignal | null {
  switch (pr.action) {
    case 'opened':
    case 'reopened':
      return pr.pull_request.draft ? 'opened_draft' : 'opened_ready'
    case 'ready_for_review':
      return 'opened_ready'
    case 'converted_to_draft':
      return 'converted_to_draft'
    case 'closed':
      return pr.pull_request.merged ? 'merged' : 'closed_unmerged'
    default:
      return null
  }
}

const CLOSING_KEYWORD =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/gi

/**
 * Issue numbers a pull request body closes with GitHub's closing keywords
 * (`Closes #12`, `fixes owner/repo#12`), limited to the PR's own repository.
 * https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
 */
export function closingIssueNumbers(
  body: string | null,
  repoFullName: string,
): number[] {
  if (!body) return []
  const repo = repoFullName.toLowerCase()
  const numbers = [...body.matchAll(CLOSING_KEYWORD)].flatMap((match) =>
    match[1] && match[1].toLowerCase() !== repo ? [] : [Number(match[2])],
  )
  return [...new Set(numbers)]
}

/**
 * Parses a verified `pull_request` delivery. Returns null for actions that
 * never move a card and for PRs that link no issue.
 */
export function parseGitHubPullRequestTarget(
  payload: unknown,
): Result<GitHubPullRequestTarget | null, GitHubWebhookResolveError> {
  const parsed = githubPullRequestWebhookSchema.safeParse(payload)
  if (!parsed.success) {
    return Result.err(
      new GitHubWebhookResolveError({
        code: 'invalid_payload',
        message: `Webhook pull_request event is malformed: ${parsed.error.message}`,
      }),
    )
  }
  const pr = parsed.data
  const signal = pullRequestSignal(pr)
  if (!signal) return Result.ok(null)
  const linkedIssueNumbers = closingIssueNumbers(
    pr.pull_request.body,
    pr.repository.full_name,
  )
  if (linkedIssueNumbers.length === 0) return Result.ok(null)
  return Result.ok({
    installationId: String(pr.installation.id),
    githubRepoId: pr.repository.id,
    fullName: pr.repository.full_name,
    number: pr.pull_request.number,
    htmlUrl: pr.pull_request.html_url,
    senderLogin: pr.sender?.login ?? null,
    signal,
    linkedIssueNumbers,
    updatedAtMs: Date.parse(pr.pull_request.updated_at),
  })
}

const STATUS_RANK: Partial<Record<IssueStatus, number>> = {
  todo: 0,
  in_progress: 1,
  blocked: 1,
  in_review: 2,
}

/**
 * The status a pull request signal moves a card to, or null to leave it.
 *
 * Forward only along todo < in_progress < in_review < done. `done` and
 * `cancelled` never move. `blocked` ranks with `in_progress`, so a draft PR
 * leaves a blocked card alone and a ready PR moves it to review. The two
 * backward moves are a PR returning to draft and a PR closing unmerged with
 * no other open PR on the issue: both send an in review (or todo) card to
 * in progress.
 */
export function nextPullRequestStatus(args: {
  current: IssueStatus
  signal: PullRequestSignal
  otherOpenPullRequests: number
}): IssueStatus | null {
  const rank = STATUS_RANK[args.current]
  if (rank === undefined) return null
  switch (args.signal) {
    case 'merged':
      return 'done'
    case 'opened_ready':
      return rank < 2 ? 'in_review' : null
    case 'opened_draft':
      return rank < 1 ? 'in_progress' : null
    case 'closed_unmerged':
      if (args.otherOpenPullRequests > 0) return null
      return args.current === 'todo' || args.current === 'in_review'
        ? 'in_progress'
        : null
    case 'converted_to_draft':
      return args.current === 'todo' || args.current === 'in_review'
        ? 'in_progress'
        : null
  }
}

const STATUS_LABEL: Record<IssueStatus, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
}

const OPEN_PULL_REQUESTS_KEY = 'github_open_pull_requests'

function openPullRequests(metadata: unknown): number[] {
  const value =
    metadata !== null && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)[OPEN_PULL_REQUESTS_KEY]
      : undefined
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number')
    : []
}

/**
 * Applies one pull request signal to one linked Garden issue inside the
 * delivery transaction, which already holds the binding row lock.
 *
 * Why the binding tracks open PRs: a PR closing unmerged sends the card back
 * to in progress only when no other open PR still links the issue. GitHub
 * does not send that fact, so the binding's metadata keeps the open PR
 * numbers this webhook has seen. PRs opened before Garden received
 * `pull_request` events are unknown to it.
 *
 * Garden's own App bot is not skipped, unlike issue edits: a PR an agent
 * opens through the App is exactly the work the card should track, and Garden
 * never writes PR state back to GitHub, so nothing echoes. A status move adds
 * a connector comment to the issue timeline naming the PR.
 */
export async function applyGitHubPullRequestUpdate(args: {
  tx: GitHubWebhookTx
  binding: GitHubWebhookBindingMatch
  target: GitHubPullRequestTarget
}): Promise<GitHubWebhookIssueApplyOutcome> {
  const { tx, binding, target } = args
  const [bindingRow] = await tx
    .select({ metadata: schema.issueSourceBinding.metadata })
    .from(schema.issueSourceBinding)
    .where(eq(schema.issueSourceBinding.id, binding.bindingId))
  const open = new Set(openPullRequests(bindingRow?.metadata))
  if (target.signal === 'merged' || target.signal === 'closed_unmerged') {
    open.delete(target.number)
  } else {
    open.add(target.number)
  }
  const otherOpenPullRequests = [...open].filter(
    (number) => number !== target.number,
  ).length
  await tx
    .update(schema.issueSourceBinding)
    .set({
      lastSyncedAt: new Date(),
      metadata: {
        ...(bindingRow?.metadata as Record<string, unknown> | null),
        [OPEN_PULL_REQUESTS_KEY]: [...open].sort((a, b) => a - b),
      },
    })
    .where(eq(schema.issueSourceBinding.id, binding.bindingId))

  const issueMatch = and(
    eq(schema.issue.id, binding.issueId),
    eq(schema.issue.workspaceId, binding.workspaceId),
  )
  const [existing] = await tx.select().from(schema.issue).where(issueMatch)
  if (!existing) return { kind: 'skipped', reason: 'unbound' }
  const current = (existing.status ?? 'todo') as IssueStatus
  const next = nextPullRequestStatus({
    current,
    signal: target.signal,
    otherOpenPullRequests,
  })
  if (!next || next === current) return { kind: 'skipped', reason: 'noop' }

  const [issue] = await tx
    .update(schema.issue)
    .set({ status: next, updatedAt: new Date() })
    .where(issueMatch)
    .returning()
  if (!issue) return { kind: 'skipped', reason: 'unbound' }

  await tx.insert(schema.issueComment).values({
    id: crypto.randomUUID(),
    issueId: binding.issueId,
    authorType: 'connector',
    authorId: null,
    body: `Moved from ${STATUS_LABEL[current]} to ${STATUS_LABEL[next]} by pull request #${target.number}: ${target.htmlUrl}`,
    metadata: {
      connector_id: 'github',
      github_login: target.senderLogin,
      html_url: target.htmlUrl,
      pull_request_number: target.number,
      pull_request_url: target.htmlUrl,
      from_status: current,
      to_status: next,
    },
  })

  return {
    kind: 'applied',
    fields: ['status'],
    previous: {
      status: existing.status,
      assigneeType: existing.assigneeType,
      assigneeId: existing.assigneeId,
    },
    issue,
  }
}

/**
 * Garden issues a pull request links, on a repository a Team links. A
 * binding left over from before a repository was unlinked does not move.
 */
export async function resolveGitHubPullRequestBindings(args: {
  db: Db
  target: GitHubPullRequestTarget
}): Promise<GitHubWebhookBindingMatch[]> {
  const { target } = args
  const links = await resolveTeamRepositoryLinks({
    db: args.db,
    installationId: target.installationId,
    githubRepoId: target.githubRepoId,
  })
  const workspaces = new Set(links.map((link) => link.workspaceId))
  if (workspaces.size === 0) return []
  const [owner = '', repo = ''] = target.fullName.split('/')
  const matches: GitHubWebhookBindingMatch[] = []
  for (const issueNumber of target.linkedIssueNumbers) {
    const bindings = await resolveGitHubWebhookBindings({
      db: args.db,
      target: {
        installationId: target.installationId,
        githubRepoId: target.githubRepoId,
        owner,
        repo,
        issueNumber,
        htmlUrl: null,
      },
    })
    matches.push(
      ...bindings.filter((binding) => workspaces.has(binding.workspaceId)),
    )
  }
  return matches
}
