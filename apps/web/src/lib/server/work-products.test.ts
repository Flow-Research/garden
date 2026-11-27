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
  type: 'brief' as string,
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
  level?: string
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
                // Not a document type, so approval does not save to Files.
                workProduct: { ...workProductRow(), type: 'connector_reply' },
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
  issueTeamId?: string | null
  savedFileHistoryId?: string
}) {
  const { schema } = await import('./db')
  const sets: Array<Record<string, unknown>> = []
  const inserts: InsertRow[] = []
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          sets.push(values)
          return Object.assign(Promise.resolve(), {
            returning: async () => [],
          })
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
                teamId:
                  args.issueTeamId === undefined ? teamId : args.issueTeamId,
                assigneeId: agentId,
                assigneeType: 'agent',
                workspaceId,
              },
            },
          ])
        }
        if (table === schema.issueRunEvent)
          return queryRows(
            args.savedFileHistoryId
              ? [{ fileId: args.savedFileHistoryId }]
              : [],
          )
        if (table === schema.teamRepository) return queryRows(args.linkedRepos)
        if (table === schema.team) return queryRows([{ name: 'Research' }])
        if (table === schema.organization) {
          return queryRows([{ name: 'Flow Research' }])
        }
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

const savedFileId = '00000000-0000-4000-8000-00000000000a'
const actorUserId = '00000000-0000-4000-8000-000000000005'

/** Files & Folders stubs: folder list/create and the shared upload path. */
const filesState = vi.hoisted(() => ({
  folders: [] as Array<{
    id: string
    workspaceId: string
    name: string
    privacy?: string
  }>,
  uploads: [] as Array<{
    name: string
    text: string
    ownerUserId: string
    workspaceId: string
  }>,
  memberships: [] as Array<{ folderId: string; fileId: string }>,
  /** Files that still exist in Brain; overwrite returns null for others. */
  existingFiles: [] as string[],
  overwrites: [] as Array<{ fileId: string; text: string }>,
  /** When set, the upload path fails with this message. */
  uploadFailure: null as string | null,
}))

vi.mock('./brain-folders', () => ({
  getOrCreateApprovedFolder: async (_db: unknown, workspaceId: string) => {
    const name = 'Flow Research'
    const existing = filesState.folders.find(
      (folder) =>
        folder.workspaceId === workspaceId &&
        folder.name === name &&
        folder.privacy === 'shared',
    )
    if (existing) return existing
    const folder = {
      id: `created-${filesState.folders.length}`,
      workspaceId,
      name,
      privacy: 'shared',
    }
    filesState.folders.push(folder)
    return folder
  },
  addBrainFolderFile: async (args: { folderId: string; fileId: string }) => {
    filesState.memberships.push({
      folderId: args.folderId,
      fileId: args.fileId,
    })
    return true
  },
}))

vi.mock('./brain-file-upload', async () => {
  const { Result } = await import('better-result')
  return {
    saveBrainFileUpload: async (args: {
      file: File
      ownerUserId: string
      workspaceId: string
    }) => {
      if (filesState.uploadFailure) {
        return Result.err({
          code: 'upload_failed' as const,
          message: filesState.uploadFailure,
        })
      }
      filesState.uploads.push({
        name: args.file.name,
        text: await args.file.text(),
        ownerUserId: args.ownerUserId,
        workspaceId: args.workspaceId,
      })
      return Result.ok({ id: savedFileId, label: args.file.name })
    },
    overwriteBrainFile: async (args: { fileId: string; body: string }) => {
      if (!filesState.existingFiles.includes(args.fileId)) {
        return Result.ok(null)
      }
      filesState.overwrites.push({ fileId: args.fileId, text: args.body })
      return Result.ok({ id: args.fileId, label: 'workstream-task-guide.md' })
    },
  }
})

/**
 * The `saved_file` JSON bound into the jsonb_set payload update, read from
 * the drizzle SQL chunk that carries it.
 */
function savedFilePayload(sets: Array<Record<string, unknown>>) {
  const update = sets.find(
    (values) => 'payload' in values && !('status' in values),
  )
  const chunks = (update?.payload as { queryChunks?: unknown[] } | undefined)
    ?.queryChunks
  const bound = chunks?.find(
    (chunk): chunk is string =>
      typeof chunk === 'string' && chunk.includes('"file_id"'),
  )
  return bound ? JSON.parse(bound) : null
}

const teamFolderId = '00000000-0000-4000-8000-000000000009'

const approve = (closeIssue: boolean) =>
  reviewWorkProduct({
    actorUserId,
    env: {} as never,
    input: { action: 'approve', close_issue: closeIssue },
    workProductId,
    workspaceId,
  })

const inReview = (overrides: Record<string, unknown>) => ({
  ...approvedWorkProduct({}),
  status: 'review',
  reviewState: 'pending',
  ...overrides,
})

describe('approve saves the work product to Files', () => {
  beforeEach(() => {
    filesState.folders = [
      {
        id: teamFolderId,
        workspaceId,
        name: 'Flow Research',
        privacy: 'shared',
      },
      { id: 'other-folder', workspaceId, name: 'Guides' },
    ]
    filesState.uploads = []
    filesState.memberships = []
    filesState.existingFiles = []
    filesState.overwrites = []
    filesState.uploadFailure = null
  })

  it.each([
    ['Approve', false],
    ['Approve and close', true],
  ])(
    '%s on a brief saves the body as Markdown in the folder named after the workspace',
    async (_label, closeIssue) => {
      const { db, inserts, sets } = await makeApplyDb({
        linkedRepos: [],
        issueTeamId: null,
        workProduct: inReview({}),
      })
      state.db = db

      const result = await approve(closeIssue)

      const fileUrl = `/api/brain/files/${savedFileId}/content`
      expect(result.isOk() && result.value).toEqual({
        action: 'approve',
        workProductId,
        files: {
          status: 'saved',
          fileId: savedFileId,
          fileName: 'workstream-task-guide.md',
          folderId: teamFolderId,
          folderName: 'Flow Research',
          url: fileUrl,
          overwritten: false,
        },
      })
      expect(filesState.uploads).toEqual([
        {
          name: 'workstream-task-guide.md',
          text: '# Workstream task guide\n\nApproved text.',
          ownerUserId: actorUserId,
          workspaceId,
        },
      ])
      expect(filesState.memberships).toEqual([
        { folderId: teamFolderId, fileId: savedFileId },
      ])
      expect(savedFilePayload(sets)).toMatchObject({
        file_id: savedFileId,
        folder_id: teamFolderId,
        url: fileUrl,
        saved_by: actorUserId,
      })
      expect(
        inserts.find(
          (row) => row.eventType === 'issue_run:work_product_saved_to_files',
        )?.payload,
      ).toMatchObject({
        file_id: savedFileId,
        folder_id: teamFolderId,
        overwritten: false,
      })
    },
  )

  it('saves the edited body when the reviewer edits on approve', async () => {
    const { db } = await makeApplyDb({
      linkedRepos: [],
      issueTeamId: null,
      workProduct: inReview({}),
    })
    state.db = db

    await reviewWorkProduct({
      actorUserId,
      env: {} as never,
      input: { action: 'approve', close_issue: false, edited_body: '# Edited' },
      workProductId,
      workspaceId,
    })

    expect(filesState.uploads.map((upload) => upload.text)).toEqual([
      '# Edited',
    ])
  })

  it('creates a shared folder named after the workspace when none exists', async () => {
    filesState.folders = []
    const { db } = await makeApplyDb({
      linkedRepos: [],
      issueTeamId: null,
      workProduct: inReview({}),
    })
    state.db = db

    const result = await approve(false)

    expect(filesState.folders).toEqual([
      {
        id: 'created-0',
        workspaceId,
        name: 'Flow Research',
        privacy: 'shared',
      },
    ])
    expect(filesState.memberships).toEqual([
      { folderId: 'created-0', fileId: savedFileId },
    ])
    expect(result.isOk() && result.value).toMatchObject({
      files: { status: 'saved', folderId: 'created-0' },
    })
  })

  it('saves a workspace issue with no Team to the folder named after the workspace', async () => {
    filesState.folders = []
    const { db } = await makeApplyDb({
      linkedRepos: [],
      issueTeamId: null,
      workProduct: inReview({}),
    })
    state.db = db

    const result = await approve(false)

    expect(filesState.folders.map((folder) => folder.name)).toEqual([
      'Flow Research',
    ])
    expect(result.isOk() && result.value).toMatchObject({
      files: { status: 'saved', folderName: 'Flow Research' },
    })
  })

  it('keeps a Team issue document out of workspace Files', async () => {
    const { db } = await makeApplyDb({
      linkedRepos: [],
      workProduct: inReview({}),
      issueTeamId: teamId,
    })
    state.db = db
    const result = await approve(false)
    expect(result.isOk() && result.value).toMatchObject({
      files: { status: 'skipped' },
    })
    expect(filesState.uploads).toHaveLength(0)
    expect(filesState.overwrites).toHaveLength(0)
  })

  it('retries a workspace document without writing another approval event', async () => {
    const { db, inserts } = await makeApplyDb({
      linkedRepos: [],
      workProduct: approvedWorkProduct({}),
      issueTeamId: null,
    })
    state.db = db
    const result = await reviewWorkProduct({
      actorUserId,
      env: {} as never,
      input: { action: 'retry_files' },
      workProductId,
      workspaceId,
    })
    expect(result.isOk() && result.value).toMatchObject({
      action: 'retry_files',
      files: { status: 'saved' },
    })
    expect(
      inserts.some(
        (row) => row.eventType === 'issue_run:work_product_approved',
      ),
    ).toBe(false)
  })

  const previousFileId = '00000000-0000-4000-8000-00000000000b'

  it('retries the latest approved body even when an older revision has a saved file', async () => {
    filesState.existingFiles = [previousFileId]
    const { db } = await makeApplyDb({
      linkedRepos: [],
      savedFileHistoryId: previousFileId,
      issueTeamId: null,
      workProduct: { ...approvedWorkProduct({}), body: 'Revised text' },
    })
    state.db = db
    const result = await reviewWorkProduct({
      actorUserId,
      env: {} as never,
      input: { action: 'retry_files' },
      workProductId,
      workspaceId,
    })
    expect(result.isOk() && result.value).toMatchObject({
      files: { status: 'saved', fileId: previousFileId, overwritten: true },
    })
    expect(filesState.overwrites).toEqual([
      { fileId: previousFileId, text: 'Revised text' },
    ])
  })

  it('does not authorize overwriting another file from the work product payload', async () => {
    filesState.existingFiles = [previousFileId]
    const { db } = await makeApplyDb({
      linkedRepos: [],
      issueTeamId: null,
      workProduct: inReview({
        payload: {
          saved_file: {
            file_id: previousFileId,
            file_name: 'private.md',
            folder_id: teamFolderId,
            url: `/api/brain/files/${previousFileId}/content`,
            saved_by: actorUserId,
            saved_at: '2026-11-01T00:00:00.000Z',
          },
        },
      }),
    })
    state.db = db
    const result = await approve(false)
    expect(result.isOk() && result.value).toMatchObject({
      files: { status: 'saved', overwritten: false },
    })
    expect(filesState.overwrites).toEqual([])
  })

  it('re-approving a revised work product overwrites the same file', async () => {
    filesState.existingFiles = [previousFileId]
    const { db, inserts } = await makeApplyDb({
      linkedRepos: [],
      savedFileHistoryId: previousFileId,
      issueTeamId: null,
      workProduct: inReview({
        payload: {
          saved_file: {
            file_id: previousFileId,
            file_name: 'workstream-task-guide.md',
            folder_id: teamFolderId,
            url: `/api/brain/files/${previousFileId}/content`,
            saved_by: actorUserId,
            saved_at: '2026-11-01T00:00:00.000Z',
          },
        },
      }),
    })
    state.db = db

    const result = await approve(false)

    expect(filesState.uploads).toEqual([])
    expect(filesState.overwrites).toEqual([
      {
        fileId: previousFileId,
        text: '# Workstream task guide\n\nApproved text.',
      },
    ])
    expect(result.isOk() && result.value).toMatchObject({
      files: { status: 'saved', fileId: previousFileId, overwritten: true },
    })
    expect(
      inserts.find(
        (row) => row.eventType === 'issue_run:work_product_saved_to_files',
      )?.payload,
    ).toMatchObject({ file_id: previousFileId, overwritten: true })
  })

  it.each(['pull_request', 'connector_reply'])(
    'approving a %s does not save anything to Files',
    async (type) => {
      const { db, inserts } = await makeApplyDb({
        linkedRepos: [],
        issueTeamId: null,
        workProduct: inReview({ type }),
      })
      state.db = db

      const result = await approve(true)

      expect(result.isOk() && result.value).toEqual({
        action: 'approve',
        workProductId,
        files: { status: 'skipped' },
      })
      expect(filesState.uploads).toEqual([])
      expect(filesState.folders).toHaveLength(2)
      expect(
        inserts.some((row) =>
          String(row.eventType).startsWith('issue_run:work_product_save'),
        ),
      ).toBe(false)
    },
  )

  it('keeps the approval and reports the failure when saving fails', async () => {
    filesState.uploadFailure = 'R2 unavailable'
    const { db, inserts } = await makeApplyDb({
      linkedRepos: [],
      issueTeamId: null,
      workProduct: inReview({}),
    })
    state.db = db

    const result = await approve(false)

    expect(result.isOk() && result.value).toEqual({
      action: 'approve',
      workProductId,
      files: { status: 'failed', message: 'R2 unavailable' },
    })
    expect(
      inserts.some(
        (row) => row.eventType === 'issue_run:work_product_approved',
      ),
    ).toBe(true)
    const failure = inserts.find(
      (row) => row.eventType === 'issue_run:work_product_save_failed',
    )
    expect(failure).toMatchObject({
      level: 'error',
      payload: { work_product_id: workProductId, error: 'R2 unavailable' },
    })
  })
})

describe('save_to_files is gone', () => {
  it('rejects the removed save_to_files review action', () => {
    expect(
      workProductReviewBodySchema.safeParse({
        action: 'save_to_files',
        folder_id: teamFolderId,
      }).success,
    ).toBe(false)
  })
})
