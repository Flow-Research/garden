import { Result, TaggedError } from 'better-result'
import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  GitHubRestClient,
  makeGitHubBaseLayer,
  type GitHubRequest,
} from '@garden/connectors/github/rest-client'
import { schema, type Db } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'

export class GitHubApiError extends TaggedError('GitHubApiError')<{
  message: string
  status: number | null
  cause?: unknown
}>() {}

/**
 * One GitHub REST call with the workspace's installation token. Routes and the
 * import Workflow take this as a value so tests can swap GitHub out without
 * mocking Effect or `fetch`.
 */
export type GitHubRequester = (
  input: GitHubRequest,
) => Promise<Result<unknown, GitHubApiError>>

export type WorkspaceGitHubInstallation = {
  installationId: string
  status: 'connected' | 'degraded' | 'disconnected'
}

/** The workspace's GitHub App installation, or null when none is stored. */
export async function loadWorkspaceGitHubInstallation(
  db: Db,
  workspaceId: string,
): Promise<WorkspaceGitHubInstallation | null> {
  const [row] = await db
    .select({
      installationId: schema.githubAppInstallation.installationId,
      status: schema.githubAppInstallation.status,
    })
    .from(schema.githubAppInstallation)
    .where(eq(schema.githubAppInstallation.workspaceId, workspaceId))
  if (!row) return null
  return {
    installationId: row.installationId,
    status: row.status as WorkspaceGitHubInstallation['status'],
  }
}

function statusOf(cause: unknown): number | null {
  if (cause === null || typeof cause !== 'object') return null
  const status = (cause as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  if (cause !== null && typeof cause === 'object') {
    const message = (cause as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'GitHub request failed'
}

/**
 * Builds a requester on the shared installation-token path from #196
 * (`makeGitHubBaseLayer` → `mintGitHubInstallationAccessToken`), so the repo
 * picker and the import get the same health gate, token cache, and
 * remint-once on 401 as the agent's GitHub tools.
 */
export function createGitHubRequester(
  env: Pick<
    AppEnv,
    'GITHUB_APP_ID' | 'GITHUB_CLIENT_ID' | 'GITHUB_APP_PRIVATE_KEY'
  >,
  installation: WorkspaceGitHubInstallation,
): GitHubRequester {
  const layer = makeGitHubBaseLayer({
    appId: env.GITHUB_APP_ID,
    clientId: env.GITHUB_CLIENT_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    installationId: installation.installationId,
    installationStatus: installation.status,
  })
  return (input) =>
    Result.tryPromise({
      try: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const client = yield* GitHubRestClient
            return yield* client.request(input)
          }).pipe(Effect.provide(layer)),
        ),
      catch: (cause) =>
        new GitHubApiError({
          message: messageOf(cause),
          status: statusOf(cause),
          cause,
        }),
    })
}

const repositorySchema = z.object({
  id: z.number().int(),
  full_name: z.string().min(1),
  private: z.boolean(),
})

export type GitHubRepository = z.infer<typeof repositorySchema>

const installationRepositoriesSchema = z.object({
  repositories: z.array(repositorySchema),
})

const PAGE_SIZE = 100

function parseResponse<T>(
  parsed: z.ZodSafeParseResult<T>,
  what: string,
): Result<T, GitHubApiError> {
  return parsed.success
    ? Result.ok(parsed.data)
    : Result.err(
        new GitHubApiError({
          message: `GitHub returned an unexpected ${what} payload`,
          status: null,
          cause: parsed.error,
        }),
      )
}

/**
 * Every repository the installation can access, for the Team repository
 * picker. Pages until GitHub returns a short page.
 */
export async function listInstallationRepositories(
  request: GitHubRequester,
): Promise<Result<GitHubRepository[], GitHubApiError>> {
  return Result.gen(async function* () {
    const repositories: GitHubRepository[] = []
    for (let page = 1; ; page += 1) {
      const body = yield* Result.await(
        request({
          operation: 'github.listInstallationRepositories',
          path: '/installation/repositories',
          query: { page, per_page: PAGE_SIZE },
        }),
      )
      const parsed = yield* parseResponse(
        installationRepositoriesSchema.safeParse(body),
        'repository list',
      )
      repositories.push(...parsed.repositories)
      if (parsed.repositories.length < PAGE_SIZE) break
    }
    return Result.ok(repositories)
  })
}

/**
 * One repository by numeric id. GitHub answers 404 when the installation
 * cannot access it, so a successful read proves the link target is in scope.
 */
export async function getInstallationRepository(
  request: GitHubRequester,
  githubRepoId: number,
): Promise<Result<GitHubRepository, GitHubApiError>> {
  return Result.gen(async function* () {
    const body = yield* Result.await(
      request({
        operation: 'github.getRepository',
        path: `/repositories/${githubRepoId}`,
      }),
    )
    return parseResponse(repositorySchema.safeParse(body), 'repository')
  })
}

/**
 * One page of a repository's open issues, oldest first so a resumed import
 * keeps numbering in GitHub order. The list includes pull requests; callers
 * drop them while parsing.
 */
export async function listOpenRepositoryIssuesPage(
  request: GitHubRequester,
  args: { fullName: string; page: number },
): Promise<Result<{ items: unknown[]; hasNextPage: boolean }, GitHubApiError>> {
  const [owner, repo] = args.fullName.split('/')
  return Result.gen(async function* () {
    const body = yield* Result.await(
      request({
        operation: 'github.listRepositoryIssues',
        path: `/repos/${encodeURIComponent(owner ?? '')}/${encodeURIComponent(repo ?? '')}/issues`,
        query: {
          state: 'open',
          sort: 'created',
          direction: 'asc',
          per_page: PAGE_SIZE,
          page: args.page,
        },
      }),
    )
    const items = yield* parseResponse(
      z.array(z.unknown()).safeParse(body),
      'issue list',
    )
    return Result.ok({ items, hasNextPage: items.length === PAGE_SIZE })
  })
}
