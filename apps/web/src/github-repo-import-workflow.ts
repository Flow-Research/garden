import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import { Result } from 'better-result'
import { createRuntimeDbClient, type Db } from '@garden/db/runtime'
import { createGardenLogger } from '@garden/observability/logger'
import type { AppEnv } from '@/lib/server/env'
import {
  createGitHubRequester,
  loadWorkspaceGitHubInstallation,
} from '@/lib/server/github-repositories'
import {
  importGitHubIssuePage,
  loadTeamRepository,
  publishCreatedIssues,
  publishTeamRepositoryChanged,
  setTeamRepositoryImportState,
  type GitHubRepoImportParams,
} from '@/lib/server/github-repo-import'

const workflowLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'github-repo-import-workflow',
})

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause)

/**
 * Runs `run` on its own pg client and closes it. A Workflow step outlives any
 * request, so it cannot borrow a request-scoped client, and a pool nothing
 * closes would leak one connection per step.
 */
async function withDb<T>(env: AppEnv, run: (db: Db) => Promise<T>) {
  const client = await createRuntimeDbClient(env.HYPERDRIVE)
  const result = await Result.tryPromise(() => run(client.db))
  await Result.tryPromise(() => client.close())
  if (result.isErr()) throw result.error.cause
  return result.value
}

/**
 * Imports a linked repository's open issues onto its Team board.
 *
 * The instance id is the `team_repository.id`, so a second start for one link
 * is a no-op, and Retry restarts the same instance. Each page is one step, so
 * Workflows retry a failed page on their default policy without repeating
 * finished pages, and a repeated page creates nothing because the upsert is
 * insert-only. Every step reloads the link and stops when it was unlinked.
 * A failure after retries moves the link to `failed` so Team settings can
 * offer Retry.
 */
export class GitHubRepoImportWorkflow extends WorkflowEntrypoint<
  AppEnv,
  GitHubRepoImportParams
> {
  override async run(
    event: WorkflowEvent<GitHubRepoImportParams>,
    step: WorkflowStep,
  ) {
    const { teamRepositoryId } = event.payload
    const execution = await Result.tryPromise(() =>
      this.importAll(teamRepositoryId, step),
    )
    if (execution.isOk()) return execution.value

    workflowLogger.error('github_repo_import.failed', {
      teamRepositoryId,
      message: errorMessage(execution.error.cause),
    })
    await step.do('mark-failed', () =>
      withDb(this.env, async (db) => {
        const row = await setTeamRepositoryImportState(
          db,
          teamRepositoryId,
          'failed',
        )
        if (row) await publishTeamRepositoryChanged(db, this.env, row)
      }),
    )
    return { teamRepositoryId, status: 'failed' as const }
  }

  /** The begin, page, and finish steps. Throws when a step exhausts retries. */
  private async importAll(teamRepositoryId: string, step: WorkflowStep) {
    const begun = await step.do('begin', () =>
      withDb(this.env, async (db) => {
        const row = await setTeamRepositoryImportState(
          db,
          teamRepositoryId,
          'importing',
        )
        if (row) await publishTeamRepositoryChanged(db, this.env, row)
        return { linked: row !== null }
      }),
    )
    if (!begun.linked) return { teamRepositoryId, status: 'unlinked' as const }

    let created = 0
    for (let page = 1; ; page += 1) {
      const result = await step.do(`page-${page}`, () =>
        withDb(this.env, async (db) => {
          const link = await loadTeamRepository(db, teamRepositoryId)
          if (!link) return { unlinked: true, created: 0, hasNextPage: false }
          const installation = await loadWorkspaceGitHubInstallation(
            db,
            link.workspaceId,
          )
          if (!installation) {
            throw new Error('The workspace has no GitHub App installation')
          }
          const imported = await importGitHubIssuePage({
            db,
            request: createGitHubRequester(this.env, installation),
            link,
            page,
          })
          if (imported.isErr()) throw imported.error
          const published: Promise<unknown>[] = []
          await publishCreatedIssues({
            db,
            env: this.env,
            waitUntil: (promise) => published.push(promise),
            workspaceId: link.workspaceId,
            issues: imported.value.created,
          })
          await Promise.all(published)
          return {
            unlinked: false,
            created: imported.value.created.length,
            hasNextPage: imported.value.hasNextPage,
          }
        }),
      )
      if (result.unlinked) {
        return { teamRepositoryId, status: 'unlinked' as const }
      }
      created += result.created
      if (!result.hasNextPage) break
    }

    await step.do('finish', () =>
      withDb(this.env, async (db) => {
        const row = await setTeamRepositoryImportState(
          db,
          teamRepositoryId,
          'ready',
        )
        if (row) await publishTeamRepositoryChanged(db, this.env, row)
      }),
    )
    workflowLogger.info('github_repo_import.completed', {
      teamRepositoryId,
      created,
    })
    return { teamRepositoryId, status: 'ready' as const, created }
  }
}
