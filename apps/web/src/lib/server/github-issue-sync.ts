import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { IssueStatus } from '@garden/core/types/issue'
import { allocateIssueSlot } from '@garden/server/issues/server'
import { attachSourceBindingInTransaction } from '@garden/server/issues/source-binding'
import { requireReturnedRow, schema, type Db } from '@/lib/server/db'
import type { TeamRepository } from '@garden/core/types'
import { recordGitHubIssueSnapshotMarker } from '@/lib/server/github-webhook-delivery'
import { githubIssueExternalIdCandidates } from '@/lib/server/github-webhook-resolve'

type Executor = Pick<Db, 'select'>

/** A GitHub account as issue payloads carry it. Ids are strings, as in `member.github_user_id`. */
export type GitHubUserRef = { id: string; login: string }

/**
 * The fields Garden reads from one GitHub issue. The REST issue list and the
 * `issues.*` webhook carry the same issue object, so both parse through
 * `parseGitHubIssueSnapshot`.
 */
export type GitHubIssueSnapshot = {
  owner: string
  repo: string
  number: number
  htmlUrl: string | null
  title: string
  body: string | null
  state: 'open' | 'closed'
  stateReason: string | null
  labels: string[]
  assignees: GitHubUserRef[]
  author: GitHubUserRef | null
  /** `updated_at` in ms: the ledger order marker for this snapshot. */
  updatedAtMs: number
}

/** The Team a linked repository feeds, as the import and webhook need it. */
export type TeamRepositoryLink = {
  id: string
  workspaceId: string
  teamId: string
  linkedBy: string
  fullName: string
}

const githubUserSchema = z
  .object({ id: z.number().int(), login: z.string().min(1) })
  .transform((user) => ({ id: String(user.id), login: user.login }))

const githubIssueSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.string().nullish(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.enum(['open', 'closed']),
  state_reason: z.string().nullish(),
  labels: z
    .array(z.union([z.string(), z.object({ name: z.string() })]))
    .nullish(),
  assignees: z.array(githubUserSchema).nullish(),
  user: githubUserSchema.nullish(),
  updated_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  pull_request: z.unknown().optional(),
})

/**
 * Parses one GitHub issue object. Returns null for pull requests, which the
 * issues API lists alongside issues and Garden does not put on boards, and
 * for objects that are not issues.
 */
export function parseGitHubIssueSnapshot(
  issue: unknown,
  fullName: string,
): GitHubIssueSnapshot | null {
  const parsed = githubIssueSchema.safeParse(issue)
  const [owner, repo] = fullName.split('/')
  if (!parsed.success || parsed.data.pull_request !== undefined) return null
  if (!owner || !repo) return null
  const data = parsed.data
  return {
    owner,
    repo,
    number: data.number,
    htmlUrl: data.html_url ?? null,
    title: data.title,
    body: data.body ?? null,
    state: data.state,
    stateReason: data.state_reason ?? null,
    labels: (data.labels ?? []).map((label) =>
      typeof label === 'string' ? label : label.name,
    ),
    assignees: data.assignees ?? [],
    author: data.user ?? null,
    updatedAtMs: Date.parse(data.updated_at),
  }
}

/** The binding key for an imported issue: `Owner/repo#<number>`. */
export function githubIssueExternalId(
  snapshot: Pick<GitHubIssueSnapshot, 'owner' | 'repo' | 'number'>,
) {
  return `${snapshot.owner}/${snapshot.repo}#${snapshot.number}`
}

/**
 * Garden status for a GitHub issue state. A close as not planned or as a
 * duplicate is `cancelled`; any other close is `done`; open is `todo`.
 */
export function githubIssueStatus(
  snapshot: Pick<GitHubIssueSnapshot, 'state' | 'stateReason'>,
): Extract<IssueStatus, 'todo' | 'done' | 'cancelled'> {
  if (snapshot.state === 'open') return 'todo'
  return snapshot.stateReason === 'not_planned' ||
    snapshot.stateReason === 'duplicate'
    ? 'cancelled'
    : 'done'
}

/**
 * Maps GitHub user ids to Garden user ids through `member.github_user_id`
 * (#170), within one workspace.
 */
export async function matchGitHubMembers(
  executor: Executor,
  workspaceId: string,
  githubUserIds: readonly string[],
): Promise<Map<string, string>> {
  if (githubUserIds.length === 0) return new Map()
  const rows = await executor
    .select({
      githubUserId: schema.member.githubUserId,
      userId: schema.member.userId,
    })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, workspaceId),
        inArray(schema.member.githubUserId, [...new Set(githubUserIds)]),
      ),
    )
  return new Map(
    rows.flatMap((row) =>
      row.githubUserId ? [[row.githubUserId, row.userId] as const] : [],
    ),
  )
}

/** The first GitHub assignee who is a Garden member, as a Garden user id. */
export function firstMatchedAssignee(
  assignees: readonly GitHubUserRef[],
  members: ReadonlyMap<string, string>,
): string | null {
  for (const assignee of assignees) {
    const userId = members.get(assignee.id)
    if (userId) return userId
  }
  return null
}

/** Binding metadata that records GitHub assignees, matched or not. */
export function githubAssigneeMetadata(assignees: readonly GitHubUserRef[]) {
  return { github_assignees: assignees.map((assignee) => assignee.login) }
}

export type GitHubIssueUpsertOutcome =
  | { kind: 'created'; issue: typeof schema.issue.$inferSelect }
  | { kind: 'existing'; issueId: string }

/**
 * Creates the Garden issue and its `issue_source_binding` for a GitHub issue
 * on a linked repository, or finds the one that exists.
 *
 * Why insert-only: the import and every `issues.*` webhook call this, and a
 * retry, a redelivery, or an import running beside a webhook must converge on
 * one row. Updates to an existing issue go through the webhook delivery
 * ledger, which orders them; refreshing fields here would let a late import
 * page overwrite a newer webhook change. A transaction-scoped advisory lock on
 * the binding key serializes two writers for the same GitHub issue, and the
 * existing check matches every external id form #236 accepts, so an issue
 * someone linked by hand is not imported twice. A created issue records the
 * snapshot's `updated_at` in the delivery ledger
 * (`recordGitHubIssueSnapshotMarker`), so a webhook older than what was
 * written here is stale.
 */
export async function upsertGitHubIssue(args: {
  db: Db
  link: TeamRepositoryLink
  snapshot: GitHubIssueSnapshot
}): Promise<GitHubIssueUpsertOutcome> {
  const { link, snapshot } = args
  const externalId = githubIssueExternalId(snapshot)
  return args.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`github-issue:${link.workspaceId}:${externalId}`}, 0))`,
    )
    const [existing] = await tx
      .select({ issueId: schema.issueSourceBinding.issueId })
      .from(schema.issueSourceBinding)
      .where(
        and(
          eq(schema.issueSourceBinding.workspaceId, link.workspaceId),
          eq(schema.issueSourceBinding.connectorId, 'github'),
          eq(schema.issueSourceBinding.sourceKind, 'issue'),
          inArray(
            schema.issueSourceBinding.externalId,
            githubIssueExternalIdCandidates({
              owner: snapshot.owner,
              repo: snapshot.repo,
              issueNumber: snapshot.number,
              htmlUrl: snapshot.htmlUrl,
            }),
          ),
        ),
      )
      .limit(1)
    if (existing) return { kind: 'existing', issueId: existing.issueId }

    const members = await matchGitHubMembers(tx, link.workspaceId, [
      ...snapshot.assignees.map((assignee) => assignee.id),
      ...(snapshot.author ? [snapshot.author.id] : []),
    ])
    const assigneeId = firstMatchedAssignee(snapshot.assignees, members)
    const status = githubIssueStatus(snapshot)
    const slot = await allocateIssueSlot(tx, {
      workspaceId: link.workspaceId,
      status,
    })
    const issueId = crypto.randomUUID()
    await tx.insert(schema.issue).values({
      id: issueId,
      workspaceId: link.workspaceId,
      teamId: link.teamId,
      number: slot.number,
      position: slot.position,
      title: snapshot.title,
      description: snapshot.body,
      status,
      labels: snapshot.labels,
      assigneeType: assigneeId ? 'user' : null,
      assigneeId,
      createdBy:
        (snapshot.author && members.get(snapshot.author.id)) ?? link.linkedBy,
    })
    const binding = await attachSourceBindingInTransaction(tx, {
      workspaceId: link.workspaceId,
      issueId,
      connectorId: 'github',
      sourceKind: 'issue',
      externalId,
      externalUrl: snapshot.htmlUrl,
      metadata: githubAssigneeMetadata(snapshot.assignees),
    })
    await recordGitHubIssueSnapshotMarker(tx, {
      bindingId: binding.binding_id,
      marker: snapshot.updatedAtMs,
    })
    const issue = requireReturnedRow(
      await tx.select().from(schema.issue).where(eq(schema.issue.id, issueId)),
      'imported issue',
    )
    return { kind: 'created', issue }
  })
}

/** A linked repository as the webhook create step reads it. */
export type ResolvedTeamRepositoryLink = TeamRepositoryLink & {
  importState: TeamRepository['import_state']
}

/**
 * Team repository links for a GitHub repository across every workspace on the
 * delivery's installation. One installation can serve several workspaces
 * (see `resolveGitHubWebhookBindings`), so this returns a list.
 */
export async function resolveTeamRepositoryLinks(args: {
  db: Db
  installationId: string
  githubRepoId: number
}): Promise<ResolvedTeamRepositoryLink[]> {
  const rows = await args.db
    .select({
      id: schema.teamRepository.id,
      workspaceId: schema.teamRepository.workspaceId,
      teamId: schema.teamRepository.teamId,
      linkedBy: schema.teamRepository.linkedBy,
      fullName: schema.teamRepository.fullName,
      importState: schema.teamRepository.importState,
    })
    .from(schema.teamRepository)
    .innerJoin(
      schema.githubAppInstallation,
      eq(
        schema.githubAppInstallation.workspaceId,
        schema.teamRepository.workspaceId,
      ),
    )
    .where(
      and(
        eq(schema.githubAppInstallation.installationId, args.installationId),
        ne(schema.githubAppInstallation.status, 'disconnected'),
        eq(schema.teamRepository.githubRepoId, args.githubRepoId),
      ),
    )
    .orderBy(schema.teamRepository.id)
  return rows.map((row) => ({
    ...row,
    importState: row.importState as TeamRepository['import_state'],
  }))
}

/** The GitHub issue a webhook delivery may need to create, and its repository. */
export type GitHubWebhookIssueCandidate = {
  githubRepoId: number
  fullName: string
  snapshot: GitHubIssueSnapshot
}

const webhookRepositorySchema = z.object({
  id: z.number().int(),
  full_name: z.string().min(1),
})

const webhookIssuePayloadSchema = z.object({
  issue: z.unknown(),
  repository: webhookRepositorySchema,
  changes: z
    .object({
      new_issue: z.unknown(),
      new_repository: webhookRepositorySchema,
    })
    .partial()
    .optional(),
})

/**
 * Reads the issue an `issues.*` delivery describes. For `transferred` that is
 * the destination issue in `changes.new_issue` and `changes.new_repository`,
 * because the delivery's own `issue` is the one that left the source
 * repository. Returns null when the payload does not carry an issue Garden can
 * board, such as a pull request.
 */
export function githubWebhookIssueCandidate(
  payload: unknown,
  action: string,
): GitHubWebhookIssueCandidate | null {
  const parsed = webhookIssuePayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  const { changes } = parsed.data
  const { issue, repository } =
    action === 'transferred' &&
    changes?.new_issue !== undefined &&
    changes.new_repository !== undefined
      ? { issue: changes.new_issue, repository: changes.new_repository }
      : parsed.data
  const snapshot = parseGitHubIssueSnapshot(issue, repository.full_name)
  if (!snapshot) return null
  return {
    githubRepoId: repository.id,
    fullName: repository.full_name,
    snapshot,
  }
}

/**
 * Creates the Garden issue for a GitHub issue on every linked repository
 * across the delivery's installation, and refreshes a link's `full_name`
 * after a rename. Returns the issues it created so the route can publish them
 * after commit.
 *
 * Which issues are created: an open one always. A closed one only while the
 * link's import has not finished. The earlier version never created a closed
 * issue, so a close that arrived before the import reached that issue was
 * dropped as unbound, and the import then wrote the issue open from its older
 * page. Created from the delivery instead, the issue carries the close and its
 * ledger marker, and the import finds it and leaves it alone. After the import
 * finishes, a closed issue that is not on the board stays off it, matching an
 * import that brings in open issues only.
 */
export async function ensureLinkedGitHubIssue(args: {
  db: Db
  installationId: string
  candidate: GitHubWebhookIssueCandidate
}): Promise<{
  created: { workspaceId: string; issue: typeof schema.issue.$inferSelect }[]
}> {
  const links = await resolveTeamRepositoryLinks({
    db: args.db,
    installationId: args.installationId,
    githubRepoId: args.candidate.githubRepoId,
  })
  const created: {
    workspaceId: string
    issue: typeof schema.issue.$inferSelect
  }[] = []
  for (const link of links) {
    if (link.fullName !== args.candidate.fullName) {
      await args.db
        .update(schema.teamRepository)
        .set({ fullName: args.candidate.fullName })
        .where(eq(schema.teamRepository.id, link.id))
    }
    if (
      args.candidate.snapshot.state !== 'open' &&
      link.importState === 'ready'
    ) {
      continue
    }
    const outcome = await upsertGitHubIssue({
      db: args.db,
      link: { ...link, fullName: args.candidate.fullName },
      snapshot: args.candidate.snapshot,
    })
    if (outcome.kind === 'created') {
      created.push({ workspaceId: link.workspaceId, issue: outcome.issue })
    }
  }
  return { created }
}
