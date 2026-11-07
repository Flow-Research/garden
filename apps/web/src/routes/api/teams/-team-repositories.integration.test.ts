// @vitest-environment node
import { randomUUID } from 'node:crypto'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { Result } from 'better-result'
import { and, eq, like } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import type { GitHubRequest } from '@garden/connectors/github/rest-client'
import { invokeRouteHandler } from '@/test/route-handler'
import type { AppRequestContext } from '@/lib/server/context'
import { GitHubApiError } from '@/lib/server/github-repositories'
import { startTeamRepositoryImport } from '@/lib/server/github-repo-import'
import { Route as RepositoriesRoute } from './$teamId/repositories'
import { Route as AvailableRoute } from './$teamId/repositories/available'
import { Route as RetryRoute } from './$teamId/repositories/$repositoryId/retry'
import {
  TEST_DB_HOOK_TIMEOUT_MS,
  makeContext,
  seedTeamRow,
  seedWorkspace,
  type FakeRole,
  type WorkspaceFixture,
} from './-fixtures'

vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {} }))

const holder = vi.hoisted(() => ({
  db: null as unknown,
  /** GitHub responses keyed by request path, then by `page` query. */
  github: new Map<string, unknown>(),
  failGitHub: false,
}))

/**
 * GitHub is served from `holder.github`; a missing path answers 404, as
 * GitHub does for a repository the installation cannot access.
 */
async function fakeGitHub(input: GitHubRequest) {
  if (holder.failGitHub) {
    return Result.err(
      new GitHubApiError({ message: 'GitHub is down', status: 502 }),
    )
  }
  const page = input.query?.page
  const key = page === undefined ? input.path : `${input.path}?page=${page}`
  return holder.github.has(key)
    ? Result.ok(holder.github.get(key))
    : Result.err(new GitHubApiError({ message: 'Not Found', status: 404 }))
}

vi.mock('@/lib/server/github-repositories', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/github-repositories')
  >()),
  createGitHubRequester: () => fakeGitHub,
}))

vi.mock('@garden/db/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@garden/db/runtime')>()),
  createRuntimeDbClient: async () => ({
    db: holder.db,
    close: async () => {},
  }),
}))

const { GitHubRepoImportWorkflow } =
  await import('@/github-repo-import-workflow')

const REPO_ID = 7001
const REPO = 'Flow-Research/import-repo'

function githubIssue(number: number, extra: Record<string, unknown> = {}) {
  return {
    number,
    title: `GitHub issue ${number}`,
    body: `Body ${number}`,
    state: 'open',
    html_url: `https://github.com/${REPO}/issues/${number}`,
    labels: [{ name: 'bug' }],
    assignees: [],
    user: { id: 1, login: 'someone' },
    ...extra,
  }
}

function makeWorkflowBinding() {
  const created = new Set<string>()
  return {
    create: vi.fn(async ({ id }: { id: string }) => {
      if (created.has(id)) {
        throw new Error('instance.already_exists: instance id in use')
      }
      created.add(id)
      return { id }
    }),
    get: vi.fn(async () => ({ restart: vi.fn(async () => {}) })),
  }
}

describe('Team repository links and import (integration)', () => {
  let testDb: TestDb
  let fixture: WorkspaceFixture
  let teamId: string
  let workflow: ReturnType<typeof makeWorkflowBinding>

  beforeAll(async () => {
    testDb = await startTestDb()
    holder.db = testDb.db
    fixture = await seedWorkspace(testDb)
    teamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Garden',
      ownerUserId: fixture.ownerId,
      memberUserIds: [fixture.memberId],
    })
    await testDb.db.insert(schema.githubAppInstallation).values({
      workspaceId: fixture.workspaceId,
      installationId: '555',
      accountLogin: 'Flow-Research',
    })
    await testDb.db
      .update(schema.member)
      .set({ githubUserId: '501', githubLogin: 'member-gh' })
      .where(eq(schema.member.userId, fixture.memberId))
    await testDb.db
      .update(schema.member)
      .set({ githubUserId: '502', githubLogin: 'admin-gh' })
      .where(eq(schema.member.userId, fixture.adminId))
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  beforeEach(async () => {
    workflow = makeWorkflowBinding()
    holder.github = new Map()
    holder.failGitHub = false
    await testDb.db.delete(schema.teamRepository)
  })

  function contextFor(userId: string, role: FakeRole, request: Request) {
    return {
      ...makeContext({ testDb, userId, role, request }),
      env: {
        GITHUB_REPO_IMPORT_WORKFLOW: workflow,
      } as unknown as AppRequestContext['env'],
    }
  }

  async function link(githubRepoId: number, userId = fixture.adminId) {
    const request = new Request(
      `https://garden.test/api/teams/${teamId}/repositories`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ github_repo_id: githubRepoId }),
      },
    )
    const response = await invokeRouteHandler(RepositoriesRoute, 'POST', {
      context: contextFor(
        userId,
        userId === fixture.adminId ? 'admin' : 'member',
        request,
      ),
      request,
      params: { teamId },
    })
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown> & {
        id: string
        code?: string
      },
    }
  }

  function serveRepository() {
    holder.github.set(`/repositories/${REPO_ID}`, {
      id: REPO_ID,
      full_name: REPO,
      private: true,
    })
  }

  async function seedLink(importState = 'pending') {
    const [row] = await testDb.db
      .insert(schema.teamRepository)
      .values({
        workspaceId: fixture.workspaceId,
        teamId,
        githubRepoId: REPO_ID,
        fullName: REPO,
        linkedBy: fixture.ownerId,
        importState,
      })
      .returning()
    return row!
  }

  /** Runs the Workflow with a step that executes each callback once. */
  async function runImport(teamRepositoryId: string) {
    const instance = Object.create(GitHubRepoImportWorkflow.prototype) as {
      env: unknown
      run: (event: unknown, step: unknown) => Promise<{ status: string }>
    }
    instance.env = {}
    const step = {
      do: vi.fn(async (_name: string, configOrRun: unknown, run?: unknown) =>
        (
          (typeof configOrRun === 'function'
            ? configOrRun
            : run) as () => Promise<unknown>
        )(),
      ),
    }
    return instance.run({ payload: { teamRepositoryId } }, step)
  }

  async function importedIssues() {
    return testDb.db
      .select({
        issue: schema.issue,
        externalId: schema.issueSourceBinding.externalId,
        metadata: schema.issueSourceBinding.metadata,
      })
      .from(schema.issueSourceBinding)
      .innerJoin(
        schema.issue,
        eq(schema.issue.id, schema.issueSourceBinding.issueId),
      )
      .where(
        and(
          eq(schema.issueSourceBinding.workspaceId, fixture.workspaceId),
          like(schema.issueSourceBinding.externalId, `${REPO}#%`),
        ),
      )
  }

  it('links a repository the installation can access and starts one import', async () => {
    serveRepository()
    const first = await link(REPO_ID)
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({
      team_id: teamId,
      github_repo_id: REPO_ID,
      full_name: REPO,
      import_state: 'pending',
    })
    expect(workflow.create).toHaveBeenCalledTimes(1)
    expect(workflow.create).toHaveBeenCalledWith({
      id: first.body.id,
      params: { teamRepositoryId: first.body.id },
    })

    const second = await link(REPO_ID)
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('TEAM_REPOSITORY_LINKED')
    expect(workflow.create).toHaveBeenCalledTimes(1)
  })

  it('refuses a repository GitHub does not expose to the installation', async () => {
    const result = await link(9999)
    expect(result.status).toBe(404)
    expect(result.body.code).toBe('GITHUB_REPOSITORY_NOT_FOUND')
    expect(await testDb.db.select().from(schema.teamRepository)).toHaveLength(0)
  })

  it('refuses a link from a Team member who cannot manage the Team', async () => {
    serveRepository()
    const result = await link(REPO_ID, fixture.memberId)
    expect(result.status).toBe(403)
    expect(workflow.create).not.toHaveBeenCalled()
  })

  it('marks which repositories are already linked in the picker', async () => {
    holder.github.set('/installation/repositories?page=1', {
      repositories: [
        { id: REPO_ID, full_name: REPO, private: true },
        { id: 7002, full_name: 'Flow-Research/other', private: false },
      ],
    })
    await seedLink('ready')
    const request = new Request(
      `https://garden.test/api/teams/${teamId}/repositories/available`,
    )
    const response = await invokeRouteHandler(AvailableRoute, 'GET', {
      context: contextFor(fixture.adminId, 'admin', request),
      request,
      params: { teamId },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      repositories: { github_repo_id: number; linked_team_id: string | null }[]
    }
    expect(body.repositories).toEqual([
      expect.objectContaining({
        github_repo_id: REPO_ID,
        linked_team_id: teamId,
      }),
      expect.objectContaining({ github_repo_id: 7002, linked_team_id: null }),
    ])
  })

  it('treats a second Workflow start for one link as already started', async () => {
    const id = randomUUID()
    const first = await startTeamRepositoryImport(workflow, id)
    const second = await startTeamRepositoryImport(workflow, id)
    expect(first.isOk() && first.value).toBe('started')
    expect(second.isOk() && second.value).toBe('already_started')
  })

  it('imports open issues page by page, skips pull requests, and imports nothing twice', async () => {
    const link = await seedLink()
    const page1 = Array.from({ length: 100 }, (_, index) =>
      index === 0
        ? githubIssue(1, {
            assignees: [
              { id: 900, login: 'stranger' },
              { id: 501, login: 'member-gh' },
            ],
            user: { id: 502, login: 'admin-gh' },
          })
        : index === 1
          ? githubIssue(2, { pull_request: { url: 'https://example.test' } })
          : githubIssue(index + 1, {
              assignees: [{ id: 900, login: 'stranger' }],
            }),
    )
    const issuesPath = `/repos/Flow-Research/import-repo/issues`
    holder.github.set(`${issuesPath}?page=1`, page1)
    holder.github.set(`${issuesPath}?page=2`, [
      githubIssue(101),
      githubIssue(102),
    ])

    const first = await runImport(link.id)
    expect(first.status).toBe('ready')
    const rows = await importedIssues()
    expect(rows).toHaveLength(101)
    expect(rows.some((row) => row.externalId === `${REPO}#2`)).toBe(false)

    const one = rows.find((row) => row.externalId === `${REPO}#1`)!
    expect(one.issue).toMatchObject({
      teamId,
      status: 'todo',
      assigneeType: 'user',
      assigneeId: fixture.memberId,
      createdBy: fixture.adminId,
      labels: ['bug'],
    })
    const three = rows.find((row) => row.externalId === `${REPO}#3`)!
    expect(three.issue).toMatchObject({
      assigneeType: null,
      assigneeId: null,
      createdBy: fixture.ownerId,
    })
    expect(three.metadata).toEqual({ github_assignees: ['stranger'] })

    const [ready] = await testDb.db
      .select()
      .from(schema.teamRepository)
      .where(eq(schema.teamRepository.id, link.id))
    expect(ready!.importState).toBe('ready')
    expect(ready!.importedAt).not.toBeNull()

    const second = await runImport(link.id)
    expect(second).toMatchObject({ status: 'ready', created: 0 })
    expect(await importedIssues()).toHaveLength(101)
  })

  it('marks the link failed when GitHub keeps failing, and Retry restarts it', async () => {
    const link = await seedLink()
    holder.failGitHub = true
    const result = await runImport(link.id)
    expect(result.status).toBe('failed')
    const [failed] = await testDb.db
      .select()
      .from(schema.teamRepository)
      .where(eq(schema.teamRepository.id, link.id))
    expect(failed!.importState).toBe('failed')

    const request = new Request(
      `https://garden.test/api/teams/${teamId}/repositories/${link.id}/retry`,
      { method: 'POST' },
    )
    const retried = await invokeRouteHandler(RetryRoute, 'POST', {
      context: contextFor(fixture.adminId, 'admin', request),
      request,
      params: { teamId, repositoryId: link.id },
    })
    expect(retried.status).toBe(200)
    expect(await retried.json()).toMatchObject({ import_state: 'pending' })
    expect(workflow.get).toHaveBeenCalledWith(link.id)

    const again = await invokeRouteHandler(RetryRoute, 'POST', {
      context: contextFor(fixture.adminId, 'admin', request),
      request,
      params: { teamId, repositoryId: link.id },
    })
    expect(again.status).toBe(409)
  })
})
