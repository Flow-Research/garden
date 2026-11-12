// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewWorkProduct, workProductReviewBodySchema } from './work-products'

const state = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return { ...actual, getDb: async () => state.db }
})

vi.mock('@garden/server/issues/server', () => ({
  wakeAgentsForIssueComment: vi.fn(),
}))

const workspaceId = '00000000-0000-4000-8000-000000000001'
const issueId = '00000000-0000-4000-8000-000000000002'
const workProductId = '00000000-0000-4000-8000-000000000003'
const runId = '00000000-0000-4000-8000-000000000004'

const workProductRow = () => ({
  id: workProductId,
  workspaceId,
  issueId,
  runId,
  agentId: null,
  type: 'brief',
  status: 'review',
  reviewState: 'pending',
  isPrimary: false,
  title: 'Brief',
  body: 'An agent wrote this.',
  payload: {},
  appliedAt: null,
  appliedExternalId: null,
  appliedExternalUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
})

type InsertRow = {
  eventType?: string
  message?: string
  payload?: unknown
}

function makeDb(args: { issueUpdateReturns: Array<{ id: string }> }) {
  const inserts: InsertRow[] = []
  const sets: Array<Record<string, unknown>> = []
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          sets.push(values)
          return { returning: async () => args.issueUpdateReturns }
        },
      }),
    }),
    execute: async () => undefined,
    select: () => ({
      from: () => ({
        where: async () => [{ nextSeq: 1 }],
      }),
    }),
    insert: () => ({
      values: async (rows: InsertRow | InsertRow[]) => {
        if (Array.isArray(rows)) inserts.push(...rows)
        else inserts.push(rows)
      },
    }),
  }
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [
              {
                workProduct: workProductRow(),
                issue: { id: issueId, status: 'in_review' },
              },
            ],
          }),
        }),
      }),
    }),
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  }
  return { db, inserts, sets }
}

describe('reviewWorkProduct approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('leaves the issue alone when the in_review status changed after load', async () => {
    const { db, inserts } = makeDb({ issueUpdateReturns: [] })
    state.db = db

    const result = await reviewWorkProduct({
      actorUserId: '00000000-0000-4000-8000-000000000005',
      env: {} as never,
      input: { action: 'approve', close_issue: true },
      workProductId,
      workspaceId,
    })

    expect(result.isOk()).toBe(true)
    expect(
      inserts.some(
        (row) => row.eventType === 'issue_run:work_product_approved',
      ),
    ).toBe(true)
    expect(inserts.some((row) => row.eventType === 'issue_run:message')).toBe(
      false,
    )
  })

  it('moves the issue to done only when the conditional update claims it', async () => {
    const { db, inserts, sets } = makeDb({
      issueUpdateReturns: [{ id: issueId }],
    })
    state.db = db

    const result = await reviewWorkProduct({
      actorUserId: '00000000-0000-4000-8000-000000000005',
      env: {} as never,
      input: { action: 'approve', close_issue: true },
      workProductId,
      workspaceId,
    })

    expect(result.isOk()).toBe(true)
    expect(inserts.some((row) => row.eventType === 'issue_run:message')).toBe(
      true,
    )
    expect(sets.some((values) => values.status === 'done')).toBe(true)
  })

  it('approve without close keeps the issue open by moving in_review to in_progress', async () => {
    const { db, inserts, sets } = makeDb({
      issueUpdateReturns: [{ id: issueId }],
    })
    state.db = db

    const result = await reviewWorkProduct({
      actorUserId: '00000000-0000-4000-8000-000000000005',
      env: {} as never,
      input: { action: 'approve', close_issue: false },
      workProductId,
      workspaceId,
    })

    expect(result.isOk()).toBe(true)
    expect(sets.some((values) => values.status === 'done')).toBe(false)
    expect(sets.some((values) => values.status === 'in_progress')).toBe(true)
    expect(
      inserts.find((row) => row.eventType === 'issue_run:message')?.payload,
    ).toEqual({ from: 'in_review', to: 'in_progress' })
  })
})

describe('workProductReviewBodySchema', () => {
  it('rejects an approve request that omits close_issue', () => {
    expect(
      workProductReviewBodySchema.safeParse({ action: 'approve' }).success,
    ).toBe(false)
  })
})

const githubCalls = vi.hoisted(
  () => [] as Array<{ name: string; input: Record<string, unknown> }>,
)

/** What already exists on GitHub, to replay an apply that failed midway. */
const githubState = vi.hoisted(() => ({
  branchExists: false,
  fileExists: false,
  openPrs: [] as unknown[],
}))

vi.mock('@garden/connectors/github/rest-client', async () => {
  const { Layer } = await import('effect')
  return { makeGitHubBaseLayer: () => Layer.empty }
})

vi.mock('@garden/connectors/github/tools', async () => {
  const { Effect } = await import('effect')
  const responses: Record<string, (input: Record<string, unknown>) => unknown> =
    {
      get_commit: () => ({ sha: 'base-sha' }),
      create_branch: (input) => ({ ref: `refs/heads/${String(input.branch)}` }),
      get_file_contents: () => null,
      list_pull_requests: () => githubState.openPrs,
      create_or_update_file: () => ({ content: { sha: 'file-sha' } }),
      create_pull_request: () => ({
        id: 9001,
        number: 42,
        html_url: 'https://github.com/Flow-Research/garden/pull/42',
      }),
    }
  return {
    githubNativeTools: Object.keys(responses).map((name) => ({
      name,
      execute: (input: Record<string, unknown>) => {
        githubCalls.push({ name, input })
        const notFound = Effect.fail({
          kind: 'not_found',
          message: 'Not Found',
        })
        if (name === 'get_file_contents') {
          return githubState.fileExists
            ? Effect.succeed({ sha: 'existing-file-sha' })
            : notFound
        }
        if (
          name === 'get_commit' &&
          String(input.ref).startsWith('garden/') &&
          !githubState.branchExists
        ) {
          return notFound
        }
        if (name === 'create_branch' && githubState.branchExists) {
          return Effect.fail({
            kind: 'unknown',
            message: 'Reference already exists',
          })
        }
        return Effect.succeed(responses[name]?.(input))
      },
    })),
  }
})

const teamId = '00000000-0000-4000-8000-000000000006'
const agentId = '00000000-0000-4000-8000-000000000007'
const prTarget = {
  repository: 'Flow-Research/garden',
  path: 'docs/guides/contribute/workstream-task-guide.md',
}

/**
 * Chainable query stub: every builder method returns the same object and
 * awaiting it (or `.limit()`) resolves to `rows`.
 */
function queryRows(rows: unknown[]) {
  const chain = Promise.resolve(rows) as Promise<unknown[]> &
    Record<string, unknown>
  for (const method of ['from', 'where', 'orderBy', 'innerJoin']) {
    chain[method] = () => chain
  }
  chain.limit = async () => rows
  return chain
}

/** Db stub for apply_pr: answers each table the apply path reads. */
async function makeApplyDb(args: {
  linkedRepos: Array<{ fullName: string }>
  workProduct: Record<string, unknown>
}) {
  const { schema } = await import('./db')
  const sets: Array<Record<string, unknown>> = []
  const inserts: InsertRow[] = []
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          sets.push(values)
        },
      }),
    }),
    execute: async () => undefined,
    select: () => queryRows([{ nextSeq: 1 }]),
    insert: () => ({
      values: async (row: InsertRow) => {
        inserts.push(row)
      },
    }),
  }
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === schema.issueWorkProduct) {
          return queryRows([
            {
              workProduct: args.workProduct,
              issue: {
                id: issueId,
                status: 'in_progress',
                teamId,
                assigneeId: agentId,
                assigneeType: 'agent',
                workspaceId,
              },
            },
          ])
        }
        if (table === schema.teamRepository) return queryRows(args.linkedRepos)
        if (table === schema.issueSourceBinding) {
          return queryRows([
            {
              id: '00000000-0000-4000-8000-000000000008',
              workspaceId,
              issueId,
              connectorId: 'github',
              sourceKind: 'issue',
              externalId: 'Flow-Research/garden#375',
              externalUrl: 'https://github.com/Flow-Research/garden/issues/375',
              displayRef: 'Flow-Research/garden#375',
              titleSnapshot: null,
              metadata: {},
              lastSyncedAt: null,
              createdAt: new Date('2026-01-01T00:00:00Z'),
              updatedAt: new Date('2026-01-01T00:00:00Z'),
            },
          ])
        }
        if (table === schema.githubAppInstallation) {
          return queryRows([{ installationId: 1, status: 'active' }])
        }
        throw new Error('unexpected table')
      },
    }),
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  }
  return { db, inserts, sets }
}

const approvedWorkProduct = (payload: Record<string, unknown>) => ({
  ...workProductRow(),
  agentId,
  status: 'approved',
  reviewState: 'approved',
  title: 'Workstream task guide',
  body: '# Workstream task guide\n\nApproved text.',
  payload,
})

const applyPr = () =>
  reviewWorkProduct({
    actorUserId: '00000000-0000-4000-8000-000000000005',
    env: {} as never,
    input: { action: 'apply_pr' },
    workProductId,
    workspaceId,
  })

/** Runs the repository's real PR contract checker against a PR body. */
async function runPrContract(pr: { title: string; body: string }) {
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const repoRoot = path.resolve(__dirname, '../../../../..')
  const eventPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'pr-contract-')),
    'event.json',
  )
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).stdout.trim()
  writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: {
        title: pr.title,
        body: pr.body,
        draft: false,
        user: { login: 'garden-app[bot]' },
        base: { ref: 'dev', sha: head },
        head: { ref: 'garden/wp', sha: head },
      },
    }),
  )
  return spawnSync(
    'node',
    ['scripts/verify-pr-contract.mjs', '--event', eventPath],
    { cwd: repoRoot, encoding: 'utf8' },
  )
}

describe('reviewWorkProduct apply_pr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    githubCalls.length = 0
    githubState.branchExists = false
    githubState.fileExists = false
    githubState.openPrs = []
  })

  it('branches from dev, writes the file, opens a contract-passing PR, and records its URL', async () => {
    const { db, inserts, sets } = await makeApplyDb({
      linkedRepos: [{ fullName: 'Flow-Research/garden' }],
      workProduct: approvedWorkProduct({ pr_target: prTarget }),
    })
    state.db = db

    const result = await applyPr()

    expect(result.isErr() ? result.error : null).toBeNull()
    expect(result.isOk() && result.value).toMatchObject({
      action: 'apply_pr',
      externalId: '42',
      externalUrl: 'https://github.com/Flow-Research/garden/pull/42',
    })

    const byName = (name: string) =>
      githubCalls.find((call) => call.name === name)?.input
    expect(byName('get_commit')).toMatchObject({ ref: 'dev' })
    const branch = byName('create_branch')
    expect(branch).toMatchObject({
      owner: 'Flow-Research',
      repo: 'garden',
      fromSha: 'base-sha',
    })
    expect(byName('create_or_update_file')).toMatchObject({
      path: prTarget.path,
      branch: branch?.branch,
      content: '# Workstream task guide\n\nApproved text.',
    })
    expect(byName('create_or_update_file')?.sha).toBeUndefined()
    const pr = byName('create_pull_request') as {
      base: string
      body: string
      head: string
      title: string
    }
    expect(pr).toMatchObject({ base: 'dev', head: branch?.branch })
    expect(pr.body).toContain('Closes #375')

    const contract = await runPrContract(pr)
    expect(contract.stderr).toBe('')
    expect(contract.stdout).toContain('PR contract passed.')

    expect(sets).toContainEqual(
      expect.objectContaining({
        status: 'applied',
        appliedExternalId: '42',
        appliedExternalUrl: 'https://github.com/Flow-Research/garden/pull/42',
      }),
    )
    expect(
      inserts.find((row) => row.eventType === 'issue_run:work_product_applied')
        ?.payload,
    ).toMatchObject({ tool: 'create_pull_request' })
  })

  it('reuses the branch and records the open PR when retried after a partial failure', async () => {
    githubState.branchExists = true
    githubState.fileExists = true
    githubState.openPrs = [
      {
        id: 9002,
        number: 41,
        html_url: 'https://github.com/Flow-Research/garden/pull/41',
      },
    ]
    const { db, sets } = await makeApplyDb({
      linkedRepos: [{ fullName: 'Flow-Research/garden' }],
      workProduct: approvedWorkProduct({ pr_target: prTarget }),
    })
    state.db = db

    const result = await applyPr()

    expect(result.isErr() ? result.error : null).toBeNull()
    const names = githubCalls.map((call) => call.name)
    expect(names).not.toContain('create_branch')
    expect(names).not.toContain('create_pull_request')
    expect(
      githubCalls.find((call) => call.name === 'list_pull_requests')?.input,
    ).toMatchObject({
      state: 'open',
      head: `Flow-Research:garden/work-product-${workProductId.slice(0, 8)}`,
    })
    expect(
      githubCalls.find((call) => call.name === 'create_or_update_file')?.input,
    ).toMatchObject({ sha: 'existing-file-sha' })
    expect(sets).toContainEqual(
      expect.objectContaining({
        status: 'applied',
        appliedExternalId: '41',
        appliedExternalUrl: 'https://github.com/Flow-Research/garden/pull/41',
      }),
    )
  })

  it('rejects a work product that is not approved', async () => {
    const { db } = await makeApplyDb({
      linkedRepos: [{ fullName: 'Flow-Research/garden' }],
      workProduct: {
        ...approvedWorkProduct({ pr_target: prTarget }),
        status: 'review',
      },
    })
    state.db = db

    const result = await applyPr()

    expect(result.isErr() && String(result.error)).toContain(
      'Only approved work products can be applied',
    )
    expect(githubCalls).toEqual([])
  })

  it('rejects a work product without a PR target', async () => {
    const { db } = await makeApplyDb({
      linkedRepos: [{ fullName: 'Flow-Research/garden' }],
      workProduct: approvedWorkProduct({}),
    })
    state.db = db

    const result = await applyPr()

    expect(result.isErr() && String(result.error)).toMatch(/pr_target/)
    expect(githubCalls).toEqual([])
  })

  it("rejects a repository that is not linked to the issue's Team", async () => {
    const { db } = await makeApplyDb({
      linkedRepos: [],
      workProduct: approvedWorkProduct({ pr_target: prTarget }),
    })
    state.db = db

    const result = await applyPr()

    expect(result.isErr() && String(result.error)).toMatch(
      /not linked to this issue's Team/,
    )
    expect(githubCalls).toEqual([])
  })
})
