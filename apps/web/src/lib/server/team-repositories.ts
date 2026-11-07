import { Result, TaggedError } from 'better-result'
import { and, asc, eq } from 'drizzle-orm'
import type {
  AvailableTeamRepository,
  TeamRepository,
} from '@garden/core/types'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import { schema, type Db } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'
import {
  createGitHubRequester,
  getInstallationRepository,
  listInstallationRepositories,
  loadWorkspaceGitHubInstallation,
  type GitHubRequester,
} from '@/lib/server/github-repositories'
import {
  restartTeamRepositoryImport,
  setTeamRepositoryImportState,
  startTeamRepositoryImport,
  toTeamRepository,
} from '@/lib/server/github-repo-import'
import type { TeamErrorCode } from '@/lib/server/team-access'

const logger = createGardenLogger({
  service: 'garden',
  component: 'team-repositories',
})

export class TeamRepositoryError extends TaggedError('TeamRepositoryError')<{
  code: TeamErrorCode
  status: number
  message: string
}>() {}

type TeamRef = { id: string; workspaceId: string }

function teamRepositoryError(
  status: number,
  code: TeamErrorCode,
  message: string,
) {
  return new TeamRepositoryError({ status, code, message })
}

/**
 * A GitHub requester for the Team's workspace, or the reason there is none.
 * A disconnected installation counts as none, because its token mint is
 * refused anyway.
 */
async function workspaceRequester(
  db: Db,
  env: AppEnv,
  workspaceId: string,
): Promise<Result<GitHubRequester, TeamRepositoryError>> {
  const installation = await loadWorkspaceGitHubInstallation(db, workspaceId)
  if (!installation || installation.status === 'disconnected') {
    return Result.err(
      teamRepositoryError(
        409,
        'GITHUB_NOT_CONNECTED',
        'Connect GitHub under Connections before linking a repository',
      ),
    )
  }
  return Result.ok(createGitHubRequester(env, installation))
}

/** Repositories linked to one Team, oldest link first. */
export async function listTeamRepositories(
  db: Db,
  team: TeamRef,
): Promise<TeamRepository[]> {
  const rows = await db
    .select()
    .from(schema.teamRepository)
    .where(eq(schema.teamRepository.teamId, team.id))
    .orderBy(asc(schema.teamRepository.createdAt))
  return rows.map(toTeamRepository)
}

/**
 * Repositories the installation can access, each marked with the Team it is
 * already linked to, so the picker can disable taken repositories.
 */
export async function listAvailableTeamRepositories(args: {
  db: Db
  env: AppEnv
  team: TeamRef
}): Promise<Result<AvailableTeamRepository[], TeamRepositoryError>> {
  return Result.gen(async function* () {
    const request = yield* Result.await(
      workspaceRequester(args.db, args.env, args.team.workspaceId),
    )
    const repositories = yield* Result.await(
      listInstallationRepositories(request).then((listed) =>
        listed.mapError(
          (error) =>
            new TeamRepositoryError({
              status: 502,
              code: 'GITHUB_REQUEST_FAILED',
              message: error.message,
            }),
        ),
      ),
    )
    const linked = await args.db
      .select({
        githubRepoId: schema.teamRepository.githubRepoId,
        teamId: schema.teamRepository.teamId,
      })
      .from(schema.teamRepository)
      .where(eq(schema.teamRepository.workspaceId, args.team.workspaceId))
    const linkedTeam = new Map(
      linked.map((row) => [row.githubRepoId, row.teamId]),
    )
    return Result.ok(
      repositories
        .map((repository) => ({
          github_repo_id: repository.id,
          full_name: repository.full_name,
          private: repository.private,
          linked_team_id: linkedTeam.get(repository.id) ?? null,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    )
  })
}

/**
 * Links a repository to a Team and starts its import.
 *
 * The repository is read from GitHub by id first, so a link can only name a
 * repository the installation can access, and `full_name` comes from GitHub,
 * not the client. The insert relies on the unique `(workspace_id,
 * github_repo_id)` index, so two admins linking one repository at once get
 * one link and one `TEAM_REPOSITORY_LINKED`. When the Workflow cannot start,
 * the link is kept as `failed` so Team settings offers Retry.
 */
export async function linkTeamRepository(args: {
  db: Db
  env: AppEnv
  team: TeamRef
  githubRepoId: number
  linkedBy: string
}): Promise<Result<TeamRepository, TeamRepositoryError>> {
  return Result.gen(async function* () {
    const request = yield* Result.await(
      workspaceRequester(args.db, args.env, args.team.workspaceId),
    )
    const repository = yield* Result.await(
      getInstallationRepository(request, args.githubRepoId).then((read) =>
        read.mapError((error) =>
          error.status === 404
            ? teamRepositoryError(
                404,
                'GITHUB_REPOSITORY_NOT_FOUND',
                'The GitHub App installation cannot access that repository',
              )
            : teamRepositoryError(502, 'GITHUB_REQUEST_FAILED', error.message),
        ),
      ),
    )
    const [inserted] = await args.db
      .insert(schema.teamRepository)
      .values({
        workspaceId: args.team.workspaceId,
        teamId: args.team.id,
        githubRepoId: repository.id,
        fullName: repository.full_name,
        linkedBy: args.linkedBy,
      })
      .onConflictDoNothing({
        target: [
          schema.teamRepository.workspaceId,
          schema.teamRepository.githubRepoId,
        ],
      })
      .returning()
    if (!inserted) {
      return Result.err(
        teamRepositoryError(
          409,
          'TEAM_REPOSITORY_LINKED',
          `${repository.full_name} is already linked to a Team`,
        ),
      )
    }

    const started = await startTeamRepositoryImport(
      args.env.GITHUB_REPO_IMPORT_WORKFLOW,
      inserted.id,
    )
    if (started.isErr()) {
      logger.error('team_repository.import_start_failed', {
        ...errorFields(started.error.cause),
        teamRepositoryId: inserted.id,
      })
      const failed = await setTeamRepositoryImportState(
        args.db,
        inserted.id,
        'failed',
      )
      return Result.ok(toTeamRepository(failed ?? inserted))
    }
    return Result.ok(toTeamRepository(inserted))
  })
}

/**
 * Removes a link. Issues already imported and their bindings stay, because
 * people may have commented on them or started runs. A running import stops
 * at its next page, which reloads the link.
 */
export async function unlinkTeamRepository(args: {
  db: Db
  team: TeamRef
  teamRepositoryId: string
}): Promise<Result<void, TeamRepositoryError>> {
  const deleted = await args.db
    .delete(schema.teamRepository)
    .where(
      and(
        eq(schema.teamRepository.id, args.teamRepositoryId),
        eq(schema.teamRepository.teamId, args.team.id),
      ),
    )
    .returning({ id: schema.teamRepository.id })
  return deleted.length > 0
    ? Result.ok()
    : Result.err(
        teamRepositoryError(
          404,
          'TEAM_REPOSITORY_NOT_FOUND',
          'Linked repository not found',
        ),
      )
}

/**
 * Runs a failed import again. Only a `failed` link can retry, so a click on a
 * stale Retry button cannot restart an import that is still running.
 */
export async function retryTeamRepositoryImport(args: {
  db: Db
  env: AppEnv
  team: TeamRef
  teamRepositoryId: string
}): Promise<Result<TeamRepository, TeamRepositoryError>> {
  const [pending] = await args.db
    .update(schema.teamRepository)
    .set({ importState: 'pending' })
    .where(
      and(
        eq(schema.teamRepository.id, args.teamRepositoryId),
        eq(schema.teamRepository.teamId, args.team.id),
        eq(schema.teamRepository.importState, 'failed'),
      ),
    )
    .returning()
  if (!pending) {
    const [exists] = await args.db
      .select({ id: schema.teamRepository.id })
      .from(schema.teamRepository)
      .where(
        and(
          eq(schema.teamRepository.id, args.teamRepositoryId),
          eq(schema.teamRepository.teamId, args.team.id),
        ),
      )
    return Result.err(
      exists
        ? teamRepositoryError(
            409,
            'TEAM_REPOSITORY_NOT_FAILED',
            'Only a failed import can be retried',
          )
        : teamRepositoryError(
            404,
            'TEAM_REPOSITORY_NOT_FOUND',
            'Linked repository not found',
          ),
    )
  }

  const workflow = args.env.GITHUB_REPO_IMPORT_WORKFLOW
  const restarted = await restartTeamRepositoryImport(workflow, pending.id)
  const started = restarted.isOk()
    ? Result.ok('started' as const)
    : await startTeamRepositoryImport(workflow, pending.id)
  if (started.isErr()) {
    logger.error('team_repository.import_retry_failed', {
      ...errorFields(started.error.cause),
      teamRepositoryId: pending.id,
    })
    const failed = await setTeamRepositoryImportState(
      args.db,
      pending.id,
      'failed',
    )
    return Result.ok(toTeamRepository(failed ?? pending))
  }
  return Result.ok(toTeamRepository(pending))
}
