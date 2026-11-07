import { Result, TaggedError } from 'better-result'
import { eq } from 'drizzle-orm'
import type { TeamRepository } from '@garden/core/types'
import { getWorkspaceIssuePrefix, toIssue } from '@/lib/server/control-plane'
import { schema, type Db } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'
import {
  parseGitHubIssueSnapshot,
  upsertGitHubIssue,
  type TeamRepositoryLink,
} from '@/lib/server/github-issue-sync'
import {
  listOpenRepositoryIssuesPage,
  type GitHubApiError,
  type GitHubIssueListCursor,
  type GitHubRequester,
} from '@/lib/server/github-repositories'
import { publishWorkspaceEvent } from '@/lib/server/realtime'

export type GitHubRepoImportParams = { teamRepositoryId: string }

/** The slice of the Workflow binding the import start path uses. */
export type GitHubRepoImportWorkflowBinding = {
  create: (options: {
    id: string
    params: GitHubRepoImportParams
  }) => Promise<unknown>
  get: (id: string) => Promise<{ restart: () => Promise<void> }>
}

export class GitHubRepoImportStartError extends TaggedError(
  'GitHubRepoImportStartError',
)<{ message: string; cause: unknown }>() {}

type TeamRepositoryRow = typeof schema.teamRepository.$inferSelect

/** API shape for a `team_repository` row. */
export function toTeamRepository(row: TeamRepositoryRow): TeamRepository {
  return {
    id: row.id,
    team_id: row.teamId,
    github_repo_id: row.githubRepoId,
    full_name: row.fullName,
    import_state: row.importState as TeamRepository['import_state'],
    imported_at: row.importedAt?.toISOString() ?? null,
    linked_by: row.linkedBy,
    created_at: row.createdAt.toISOString(),
  }
}

/** The link row for an import, or null after the repository was unlinked. */
export async function loadTeamRepository(
  db: Db,
  teamRepositoryId: string,
): Promise<TeamRepositoryRow | null> {
  const [row] = await db
    .select()
    .from(schema.teamRepository)
    .where(eq(schema.teamRepository.id, teamRepositoryId))
  return row ?? null
}

/** Moves a link's import state; `ready` also stamps `imported_at`. */
export async function setTeamRepositoryImportState(
  db: Db,
  teamRepositoryId: string,
  importState: TeamRepository['import_state'],
): Promise<TeamRepositoryRow | null> {
  const [row] = await db
    .update(schema.teamRepository)
    .set({
      importState,
      ...(importState === 'ready' ? { importedAt: new Date() } : {}),
    })
    .where(eq(schema.teamRepository.id, teamRepositoryId))
    .returning()
  return row ?? null
}

/**
 * The event that tells open Team pages a repository link changed.
 * `team:updated` invalidates the workspace's Team queries, which hold the
 * repository list.
 */
export function teamRepositoryChangedEvent(
  team: Pick<
    typeof schema.team.$inferSelect,
    'id' | 'workspaceId' | 'ownerUserId'
  >,
) {
  return {
    type: 'team:updated' as const,
    payload: {
      workspace_id: team.workspaceId,
      team_id: team.id,
      owner_user_id: team.ownerUserId,
    },
  }
}

/** Publishes `teamRepositoryChangedEvent` for a link the Workflow moved. */
export async function publishTeamRepositoryChanged(
  db: Db,
  env: AppEnv,
  row: Pick<TeamRepositoryRow, 'workspaceId' | 'teamId'>,
) {
  const [team] = await db
    .select()
    .from(schema.team)
    .where(eq(schema.team.id, row.teamId))
  if (!team) return
  await publishWorkspaceEvent(
    env,
    row.workspaceId,
    teamRepositoryChangedEvent(team),
  )
}

/**
 * Imports one page of a linked repository's open issues. Pull requests are
 * skipped, and an issue that already has a binding is left alone, so running
 * a page twice creates nothing the second time. Returns the issues this call
 * created, so the caller can publish them after commit, and the cursor for
 * the next page, or null after the last one.
 */
export async function importGitHubIssuePage(args: {
  db: Db
  request: GitHubRequester
  link: TeamRepositoryLink
  cursor: GitHubIssueListCursor
}): Promise<
  Result<
    {
      created: (typeof schema.issue.$inferSelect)[]
      next: GitHubIssueListCursor | null
    },
    GitHubApiError
  >
> {
  const page = await listOpenRepositoryIssuesPage(args.request, {
    fullName: args.link.fullName,
    cursor: args.cursor,
  })
  if (page.isErr()) return Result.err(page.error)
  const created: (typeof schema.issue.$inferSelect)[] = []
  for (const item of page.value.items) {
    const snapshot = parseGitHubIssueSnapshot(item, args.link.fullName)
    if (!snapshot || snapshot.state !== 'open') continue
    const outcome = await upsertGitHubIssue({
      db: args.db,
      link: args.link,
      snapshot,
    })
    if (outcome.kind === 'created') created.push(outcome.issue)
  }
  return Result.ok({ created, next: page.value.next })
}

/**
 * Publishes `issue:created` for issues a sync wrote, after their commit. The
 * issue prefix is read before anything is handed to `waitUntil`, because a
 * request's database client closes when the response is sent.
 */
export async function publishCreatedIssues(args: {
  db: Db
  env: AppEnv
  waitUntil: (promise: Promise<unknown>) => void
  workspaceId: string
  issues: readonly (typeof schema.issue.$inferSelect)[]
}) {
  if (args.issues.length === 0) return
  const issuePrefix = await getWorkspaceIssuePrefix(args.db, args.workspaceId)
  for (const issue of args.issues) {
    args.waitUntil(
      publishWorkspaceEvent(args.env, args.workspaceId, {
        type: 'issue:created',
        payload: { issue: toIssue(issue, { issuePrefix }) },
      }),
    )
  }
}

const DUPLICATE_INSTANCE_PATTERNS = [
  'instance.already_exists',
  'already exists',
  'duplicate',
]

function isDuplicateInstanceError(cause: unknown) {
  const message = (
    cause instanceof Error ? cause.message : String(cause)
  ).toLowerCase()
  return DUPLICATE_INSTANCE_PATTERNS.some((pattern) =>
    message.includes(pattern),
  )
}

/**
 * Starts the import Workflow for a new link. The instance id is the
 * `team_repository.id`, so a second start for the same link is refused by
 * Cloudflare and treated here as already started instead of an error.
 */
export async function startTeamRepositoryImport(
  workflow: GitHubRepoImportWorkflowBinding,
  teamRepositoryId: string,
): Promise<Result<'started' | 'already_started', GitHubRepoImportStartError>> {
  const created = await Result.tryPromise({
    try: () =>
      workflow.create({
        id: teamRepositoryId,
        params: { teamRepositoryId },
      }),
    catch: (cause) => cause,
  })
  if (created.isOk()) return Result.ok('started')
  if (isDuplicateInstanceError(created.error)) {
    return Result.ok('already_started')
  }
  return Result.err(
    new GitHubRepoImportStartError({
      message: 'Could not start the repository import',
      cause: created.error,
    }),
  )
}

/**
 * Runs a failed import again. Restarting the instance keeps its id equal to
 * the link id, so a double click on Retry cannot run two imports for one link.
 */
export async function restartTeamRepositoryImport(
  workflow: GitHubRepoImportWorkflowBinding,
  teamRepositoryId: string,
): Promise<Result<void, GitHubRepoImportStartError>> {
  return Result.tryPromise({
    try: async () => {
      const instance = await workflow.get(teamRepositoryId)
      await instance.restart()
    },
    catch: (cause) =>
      new GitHubRepoImportStartError({
        message: 'Could not restart the repository import',
        cause,
      }),
  })
}
