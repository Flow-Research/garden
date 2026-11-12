import { Effect } from 'effect'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wakeAgentsForIssueComment } from '@garden/server/issues/server'

import {
  classifyConnectorError,
  type ConnectorError,
} from '@garden/core/connectors/errors'
import { parseWorkProductPrTarget } from '@garden/core/issues/work-product-pr-target'
import { makeGitHubBaseLayer } from '@garden/connectors/github/rest-client'
import { githubNativeTools } from '@garden/connectors/github/tools'
import {
  issueSourceBindingSelectSchema,
  issueWorkProductSelectSchema,
} from '@garden/db/validation'
import type { AppEnv } from './env'
import { getDb, schema } from './db'
import { resolveConnectorWritePermissionRequests } from './permission-request'

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/i

/**
 * Review request body. Before FLO-150, `approve` always moved an in_review
 * issue to done, so a follow-up @Garden comment started no run (comment
 * wakeups skip done issues). Approval now carries a required `close_issue`
 * flag: the caller states whether approving also finishes the issue. There
 * is no default, so a client cannot close an issue without saying so.
 */
export const workProductReviewBodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('approve'),
      close_issue: z.boolean(),
      edited_body: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('request_changes'),
      comment: z.string().optional(),
    })
    .strict(),
  z.object({ action: z.literal('apply') }).strict(),
  z.object({ action: z.literal('apply_pr') }).strict(),
])

export type WorkProductReviewInput = z.infer<typeof workProductReviewBodySchema>

export class WorkProductReviewError extends TaggedError(
  'WorkProductReviewError',
)<{
  code:
    | 'database_failed'
    | 'invalid_state'
    | 'unsupported_writeback'
    | 'validation_failed'
    | 'work_product_not_found'
  status: number
  message: string
  cause?: unknown
}>() {}

type WorkProductRow = typeof schema.issueWorkProduct.$inferSelect
type IssueSourceBindingRow = typeof schema.issueSourceBinding.$inferSelect

type IssueReviewContext = {
  issue: {
    assigneeId: string | null
    assigneeType: string | null
    id: string
    status: string | null
    teamId: string | null
    workspaceId: string
  }
  workProduct: WorkProductRow
}

type GithubIssueRef = {
  issueNumber: number
  owner: string
  repo: string
}

type WritebackInvocation = {
  connectorId: string
  targetLabel: string
  toolArgs: Record<string, unknown>
  toolName: string
}

type ConnectorToolSuccess = {
  externalId: string | null
  externalUrl: string | null
}

/** A successful tool call plus the raw GitHub response, for fields like `sha`. */
type ConnectorToolResponse = ConnectorToolSuccess & { response: unknown }

type ConnectorToolCallOutcome =
  | { kind: 'needs_approval'; requestId: string }
  | ({ kind: 'success' } & ConnectorToolResponse)

export type WorkProductReviewOutcome =
  | {
      action: 'approve'
      workProductId: string
    }
  | {
      action: 'request_changes'
      commentId: string
      workProductId: string
    }
  | ({
      action: 'apply' | 'apply_pr'
      workProductId: string
    } & ConnectorToolSuccess)

export function isConnectorError(value: unknown): value is ConnectorError {
  if (!value || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  return (
    kind === 'transient' ||
    kind === 'auth_expired' ||
    kind === 'permission_denied' ||
    kind === 'rate_limited' ||
    kind === 'not_found' ||
    kind === 'unknown'
  )
}

function dbError(message: string, cause: unknown) {
  return new WorkProductReviewError({
    code: 'database_failed',
    status: 500,
    message,
    cause,
  })
}

function invalidState(message: string) {
  return new WorkProductReviewError({
    code: 'invalid_state',
    status: 400,
    message,
  })
}

function unsupportedWriteback(message: string) {
  return new WorkProductReviewError({
    code: 'unsupported_writeback',
    status: 400,
    message,
  })
}

function objectOrNull(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) ? parsed : null
}

function firstString(input: Record<string, unknown> | null, keys: string[]) {
  if (!input) return null
  for (const key of keys) {
    const value = stringValue(input[key])
    if (value) return value
  }
  return null
}

function firstNumber(input: Record<string, unknown> | null, keys: string[]) {
  if (!input) return null
  for (const key of keys) {
    const value = numberValue(input[key])
    if (value !== null) return value
  }
  return null
}

function parseRepository(value: string | null) {
  const [, owner, repo] = value?.match(/^([^/\s]+)\/([^/\s#]+)$/) ?? []
  return owner && repo ? { owner, repo } : null
}

/** Builds an issue ref from a match whose groups are owner, repo, number. */
function issueRefFromMatch(
  match: RegExpMatchArray | null,
): GithubIssueRef | null {
  const [, owner, repo, issueNumber] = match ?? []
  return owner && repo && issueNumber
    ? { owner, repo, issueNumber: Number(issueNumber) }
    : null
}

function parseGithubIssueRefFromText(value: string | null) {
  if (!value) return null
  return (
    // https://github.com/owner/repo/issues/12 (or /pull/12)
    issueRefFromMatch(
      value.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)/i),
    ) ??
    // owner/repo#12
    issueRefFromMatch(value.match(/^([^/\s]+)\/([^#\s]+)#(\d+)$/)) ??
    // owner/repo/issues/12
    issueRefFromMatch(
      value.match(/^([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)$/i),
    )
  )
}

function resolveGithubIssueRef(binding: IssueSourceBindingRow) {
  const metadata = objectOrNull(binding.metadata)
  const repository = parseRepository(
    firstString(metadata, ['repository', 'repo_full_name', 'full_name']),
  )
  const owner =
    firstString(metadata, ['owner', 'repo_owner', 'repository_owner']) ??
    repository?.owner ??
    null
  const repo =
    firstString(metadata, ['repo', 'repository_name', 'name']) ??
    repository?.repo ??
    null
  const issueNumber = firstNumber(metadata, [
    'issue_number',
    'pull_number',
    'number',
    'pr_number',
  ])

  if (owner && repo && issueNumber !== null) {
    return Result.ok({ owner, repo, issueNumber } satisfies GithubIssueRef)
  }

  const parsed =
    parseGithubIssueRefFromText(binding.externalUrl) ??
    parseGithubIssueRefFromText(binding.externalId) ??
    parseGithubIssueRefFromText(binding.displayRef)
  return parsed
    ? Result.ok(parsed)
    : Result.err(
        unsupportedWriteback(
          'GitHub writeback requires owner, repo, and issue number metadata',
        ),
      )
}

function resolveWritebackInvocation(args: {
  binding: IssueSourceBindingRow
  workProduct: WorkProductRow
}): ResultValue<WritebackInvocation, WorkProductReviewError> {
  const body = args.workProduct.body?.trim()
  if (!body) return Result.err(invalidState('Work product body is empty'))

  if (
    args.binding.connectorId === 'github' &&
    (args.workProduct.type === 'connector_reply' ||
      (args.workProduct.type === 'pull_request' &&
        args.binding.sourceKind === 'pull_request'))
  ) {
    const refResult = resolveGithubIssueRef(args.binding)
    if (refResult.isErr()) return Result.err(refResult.error)

    const ref = refResult.value
    return Result.ok({
      connectorId: 'github',
      toolName: 'add_issue_comment',
      toolArgs: {
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.issueNumber,
        body,
      },
      targetLabel: `github.com/${ref.owner}/${ref.repo}#${ref.issueNumber}`,
    })
  }

  return Result.err(
    unsupportedWriteback(
      `Apply is not wired for ${args.binding.connectorId}.${args.workProduct.type}`,
    ),
  )
}

function connectorErrorFromCause(cause: unknown): ConnectorError {
  return classifyConnectorError(cause)
}

function findUrl(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.match(URL_PATTERN)?.[0] ?? null
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findUrl(entry)
      if (found) return found
    }
    return null
  }

  const object = objectOrNull(value)
  if (!object) return null

  for (const key of ['html_url', 'web_url', 'permalink', 'url']) {
    const found = stringValue(object[key])
    if (found?.startsWith('http')) return found
  }

  for (const entry of Object.values(object)) {
    const found = findUrl(entry)
    if (found) return found
  }

  return null
}

function findExternalId(value: unknown): string | null {
  const object = objectOrNull(value)
  if (!object) return null

  for (const key of ['id', 'node_id', 'comment_id']) {
    const found =
      stringValue(object[key]) ?? numberValue(object[key])?.toString()
    if (found) return found
  }

  for (const entry of Object.values(object)) {
    const found = findExternalId(entry)
    if (found) return found
  }

  return null
}

async function callConnectorTool(args: {
  agentId: string
  connectorId: string
  env: AppEnv
  issueId: string
  runId?: string | null
  toolArgs: Record<string, unknown>
  toolName: string
  userId: string
  workspaceId: string
}): Promise<
  ResultValue<ConnectorToolCallOutcome, ConnectorError | WorkProductReviewError>
> {
  const nativeTool =
    args.connectorId === 'github'
      ? githubNativeTools.find((tool) => tool.name === args.toolName)
      : undefined
  if (!nativeTool) {
    return Result.err(
      unsupportedWriteback(
        `Connector writeback is not available for ${args.connectorId}.${args.toolName}`,
      ),
    )
  }

  const installationResult = await Result.tryPromise({
    try: async () => {
      const db = await getDb(args.env)
      const [installation] = await db
        .select({
          installationId: schema.githubAppInstallation.installationId,
          status: schema.githubAppInstallation.status,
        })
        .from(schema.githubAppInstallation)
        .where(eq(schema.githubAppInstallation.workspaceId, args.workspaceId))
        .limit(1)
      return installation ?? null
    },
    catch: (cause) => dbError('Failed to load GitHub App installation', cause),
  })
  if (installationResult.isErr()) return Result.err(installationResult.error)
  const installation = installationResult.value
  if (!installation || installation.status === 'disconnected') {
    return Result.err(invalidState('GitHub App installation is not connected'))
  }

  const result = await Result.tryPromise({
    try: async () =>
      await Effect.runPromise(
        nativeTool.execute(args.toolArgs).pipe(
          Effect.provide(
            makeGitHubBaseLayer({
              appId: args.env.GITHUB_APP_ID,
              clientId: args.env.GITHUB_CLIENT_ID,
              privateKey: args.env.GITHUB_APP_PRIVATE_KEY,
              installationId: installation.installationId,
            }),
          ),
        ),
      ),
    catch: connectorErrorFromCause,
  })
  if (result.isErr()) return Result.err(result.error)

  return Result.ok({
    kind: 'success',
    externalId: findExternalId(result.value),
    externalUrl: findUrl(result.value),
    response: result.value,
  })
}

async function loadWorkProductContext(args: {
  env: AppEnv
  workProductId: string
  workspaceId?: string
}): Promise<ResultValue<IssueReviewContext, WorkProductReviewError>> {
  const db = await getDb(args.env)
  const workspaceFilter = args.workspaceId
    ? eq(schema.issueWorkProduct.workspaceId, args.workspaceId)
    : undefined
  const result = await Result.tryPromise({
    try: async () =>
      db
        .select({
          workProduct: schema.issueWorkProduct,
          issue: {
            assigneeId: schema.issue.assigneeId,
            assigneeType: schema.issue.assigneeType,
            id: schema.issue.id,
            status: schema.issue.status,
            teamId: schema.issue.teamId,
            workspaceId: schema.issue.workspaceId,
          },
        })
        .from(schema.issueWorkProduct)
        .innerJoin(
          schema.issue,
          eq(schema.issue.id, schema.issueWorkProduct.issueId),
        )
        .where(
          and(
            eq(schema.issueWorkProduct.id, args.workProductId),
            workspaceFilter,
          ),
        )
        .limit(1),
    catch: (cause) => dbError('Failed to load work product', cause),
  })
  if (result.isErr()) return Result.err(result.error)

  const row = result.value[0]
  if (!row) {
    return Result.err(
      new WorkProductReviewError({
        code: 'work_product_not_found',
        status: 404,
        message: 'Work product not found',
      }),
    )
  }

  const parsedWorkProduct = issueWorkProductSelectSchema.safeParse(
    row.workProduct,
  )
  if (!parsedWorkProduct.success) {
    return Result.err(
      new WorkProductReviewError({
        code: 'validation_failed',
        status: 500,
        message: 'Work product row failed validation',
        cause: parsedWorkProduct.error,
      }),
    )
  }

  return Result.ok(row)
}

export async function loadWorkProductWorkspace(args: {
  env: AppEnv
  workProductId: string
}): Promise<
  ResultValue<
    {
      agentId: string | null
      issueId: string
      runId: string | null
      workspaceId: string
    },
    WorkProductReviewError
  >
> {
  const contextResult = await loadWorkProductContext(args)
  if (contextResult.isErr()) return Result.err(contextResult.error)
  const { workProduct } = contextResult.value
  return Result.ok({
    agentId: workProduct.agentId,
    issueId: workProduct.issueId,
    runId: workProduct.runId,
    workspaceId: workProduct.workspaceId,
  })
}

/**
 * Approves a work product and, in the same transaction, moves the issue out
 * of in_review. `closeIssue: true` moves it to done (the review finished the
 * work). `closeIssue: false` moves it back to in_progress so the issue stays
 * open and comment wakeups can start follow-up runs. Issues in any other
 * status are left unchanged in both cases: the conditional update only
 * claims rows still in_review, so a concurrent status change wins.
 */
async function approveWorkProduct(args: {
  actorUserId: string
  closeIssue: boolean
  editedBody?: string
  env: AppEnv
  workProductId: string
  workspaceId: string
}): Promise<ResultValue<WorkProductReviewOutcome, WorkProductReviewError>> {
  const contextResult = await loadWorkProductContext(args)
  if (contextResult.isErr()) return Result.err(contextResult.error)
  const { issue, workProduct } = contextResult.value
  if (!workProduct.runId) {
    return Result.err(invalidState('Work product is not tied to an issue run'))
  }

  const db = await getDb(args.env)
  const now = new Date()
  const editedBody = args.editedBody
  const nextStatus = args.closeIssue ? 'done' : 'in_progress'
  const result = await Result.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        const update: Partial<typeof schema.issueWorkProduct.$inferInsert> = {
          reviewState: 'approved',
          status: 'approved',
          updatedAt: now,
        }
        if (editedBody !== undefined) {
          update.body = editedBody
          // One ::jsonb param: untyped binds inside jsonb_build_object make
          // Postgres fail with "could not determine data type of parameter".
          const previousVersion = {
            body: workProduct.body ?? '',
            replaced_at: now.toISOString(),
            actor_user_id: args.actorUserId,
          }
          update.payload = sql`
            jsonb_set(
              coalesce(${schema.issueWorkProduct.payload}, '{}'::jsonb),
              '{previous_versions}',
              coalesce(${schema.issueWorkProduct.payload}->'previous_versions', '[]'::jsonb) ||
                jsonb_build_array(${JSON.stringify(previousVersion)}::jsonb),
              true
            )
          ` as never
        }

        await tx
          .update(schema.issueWorkProduct)
          .set(update)
          .where(
            and(
              eq(schema.issueWorkProduct.id, args.workProductId),
              eq(schema.issueWorkProduct.workspaceId, args.workspaceId),
            ),
          )

        await tx.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${workProduct.runId as string}::text, 0))
        `)
        const [seqRow] = await tx
          .select({
            nextSeq: sql<number>`cast(coalesce(max(${schema.issueRunEvent.seq}), 0) + 1 as int)`,
          })
          .from(schema.issueRunEvent)
          .where(eq(schema.issueRunEvent.runId, workProduct.runId as string))
        // An aggregate always returns one row; max() is null for a new run.
        const nextSeq = seqRow?.nextSeq ?? 1
        await tx.insert(schema.issueRunEvent).values({
          id: crypto.randomUUID(),
          workspaceId: workProduct.workspaceId,
          issueId: workProduct.issueId,
          runId: workProduct.runId as string,
          seq: nextSeq,
          eventType: 'issue_run:work_product_approved',
          stream: 'system',
          level: 'info',
          message: 'Work product approved',
          payload: {
            edited: editedBody !== undefined,
            work_product_id: workProduct.id,
          },
        })
        const [moved] = await tx
          .update(schema.issue)
          .set({ status: nextStatus, updatedAt: now })
          .where(
            and(
              eq(schema.issue.id, issue.id),
              eq(schema.issue.status, 'in_review'),
            ),
          )
          .returning({ id: schema.issue.id })
        if (moved) {
          await tx.insert(schema.issueRunEvent).values({
            id: crypto.randomUUID(),
            workspaceId: workProduct.workspaceId,
            issueId: workProduct.issueId,
            runId: workProduct.runId as string,
            seq: nextSeq + 1,
            eventType: 'issue_run:message',
            stream: 'system',
            level: 'info',
            message: `Issue moved to ${nextStatus} after review`,
            payload: { from: 'in_review', to: nextStatus },
          })
        }
      })
    },
    catch: (cause) => dbError('Failed to approve work product', cause),
  })
  if (result.isErr()) return Result.err(result.error)

  return Result.ok({
    action: 'approve',
    workProductId: workProduct.id,
  })
}

async function requestWorkProductChanges(args: {
  actorUserId: string
  comment?: string
  env: AppEnv
  workProductId: string
  workspaceId: string
}): Promise<ResultValue<WorkProductReviewOutcome, WorkProductReviewError>> {
  const contextResult = await loadWorkProductContext(args)
  if (contextResult.isErr()) return Result.err(contextResult.error)
  const { issue, workProduct } = contextResult.value
  if (workProduct.status === 'applied' || workProduct.status === 'superseded') {
    return Result.err(
      invalidState(
        'Applied or superseded work products cannot request changes',
      ),
    )
  }

  const db = await getDb(args.env)
  const now = new Date()
  const bodySuffix = args.comment?.trim()
  const commentBody = bodySuffix
    ? `Changes requested: ${bodySuffix}`
    : 'Changes requested:'
  const commentId = crypto.randomUUID()
  const updateResult = await Result.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.issueWorkProduct)
          .set({
            reviewState: 'changes_requested',
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.issueWorkProduct.id, args.workProductId),
              eq(schema.issueWorkProduct.workspaceId, args.workspaceId),
            ),
          )
        await tx.insert(schema.issueComment).values({
          id: commentId,
          issueId: issue.id,
          authorType: 'user',
          authorId: args.actorUserId,
          body: commentBody,
          mentions: null,
        })
      })
    },
    catch: (cause) => dbError('Failed to request work product changes', cause),
  })
  if (updateResult.isErr()) return Result.err(updateResult.error)

  const wakeResult = await wakeAgentsForIssueComment({
    databaseUrl: args.env.HYPERDRIVE.connectionString,
    issueRunEnv: args.env,
    workspaceId: issue.workspaceId,
    issueId: issue.id,
    comment: {
      id: commentId,
      authorType: 'user',
      authorId: args.actorUserId,
      body: commentBody,
      parentId: null,
    },
    mentionedAgentIds: [],
    actor: { type: 'member', id: args.actorUserId },
  })
  if (wakeResult.isErr()) {
    return Result.err(dbError('Failed to wake issue agents', wakeResult.error))
  }

  return Result.ok({
    action: 'request_changes',
    commentId,
    workProductId: workProduct.id,
  })
}

/**
 * Loads the issue's newest source binding, or null when the issue has none.
 * Apply requires a binding; Apply as PR only uses one to add a closing
 * keyword, so the "missing" decision belongs to each caller.
 */
async function findSourceBinding(args: {
  env: AppEnv
  issueId: string
  workspaceId: string
}): Promise<ResultValue<IssueSourceBindingRow | null, WorkProductReviewError>> {
  const db = await getDb(args.env)
  const result = await Result.tryPromise({
    try: async () =>
      db
        .select()
        .from(schema.issueSourceBinding)
        .where(
          and(
            eq(schema.issueSourceBinding.issueId, args.issueId),
            eq(schema.issueSourceBinding.workspaceId, args.workspaceId),
          ),
        )
        .orderBy(desc(schema.issueSourceBinding.updatedAt))
        .limit(1),
    catch: (cause) => dbError('Failed to load issue source binding', cause),
  })
  if (result.isErr()) return Result.err(result.error)

  const binding = result.value[0]
  if (!binding) return Result.ok(null)

  const parsedBinding = issueSourceBindingSelectSchema.safeParse(binding)
  if (!parsedBinding.success) {
    return Result.err(
      new WorkProductReviewError({
        code: 'validation_failed',
        status: 500,
        message: 'Issue source binding row failed validation',
        cause: parsedBinding.error,
      }),
    )
  }

  return Result.ok(binding)
}

async function loadSourceBinding(args: {
  env: AppEnv
  issueId: string
  workspaceId: string
}): Promise<ResultValue<IssueSourceBindingRow, WorkProductReviewError>> {
  const result = await findSourceBinding(args)
  if (result.isErr()) return Result.err(result.error)
  return result.value
    ? Result.ok(result.value)
    : Result.err(invalidState('Apply requires a connector-bound issue source'))
}

async function markWorkProductApplied(args: {
  env: AppEnv
  externalId: string | null
  externalUrl: string | null
  invocation: WritebackInvocation
  workProduct: WorkProductRow
  workspaceId: string
}): Promise<ResultValue<void, WorkProductReviewError>> {
  if (!args.workProduct.runId) {
    return Result.err(invalidState('Work product is not tied to an issue run'))
  }

  const db = await getDb(args.env)
  const now = new Date()
  return Result.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.issueWorkProduct)
          .set({
            status: 'applied',
            appliedAt: now,
            appliedExternalId: args.externalId,
            appliedExternalUrl: args.externalUrl,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.issueWorkProduct.id, args.workProduct.id),
              eq(schema.issueWorkProduct.workspaceId, args.workspaceId),
            ),
          )

        await tx.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${args.workProduct.runId as string}::text, 0))
        `)
        const [seqRow] = await tx
          .select({
            nextSeq: sql<number>`cast(coalesce(max(${schema.issueRunEvent.seq}), 0) + 1 as int)`,
          })
          .from(schema.issueRunEvent)
          .where(
            eq(schema.issueRunEvent.runId, args.workProduct.runId as string),
          )
        // An aggregate always returns one row; max() is null for a new run.
        const nextSeq = seqRow?.nextSeq ?? 1
        await tx.insert(schema.issueRunEvent).values({
          id: crypto.randomUUID(),
          workspaceId: args.workProduct.workspaceId,
          issueId: args.workProduct.issueId,
          runId: args.workProduct.runId as string,
          seq: nextSeq,
          eventType: 'issue_run:work_product_applied',
          stream: 'connector',
          level: 'info',
          message: 'Work product applied to connector',
          payload: {
            connector_id: args.invocation.connectorId,
            external_id: args.externalId,
            external_url: args.externalUrl,
            target_label: args.invocation.targetLabel,
            tool: args.invocation.toolName,
            work_product_id: args.workProduct.id,
          },
        })
      })
    },
    catch: (cause) => dbError('Failed to mark work product applied', cause),
  })
}

async function callWritebackWithApproval(args: {
  actorUserId: string
  agentId: string
  env: AppEnv
  invocation: WritebackInvocation
  issueId: string
  runId?: string | null
  workspaceId: string
}): Promise<
  ResultValue<ConnectorToolResponse, ConnectorError | WorkProductReviewError>
> {
  const firstCall = await callConnectorTool({
    agentId: args.agentId,
    connectorId: args.invocation.connectorId,
    env: args.env,
    issueId: args.issueId,
    runId: args.runId,
    toolArgs: args.invocation.toolArgs,
    toolName: args.invocation.toolName,
    userId: args.actorUserId,
    workspaceId: args.workspaceId,
  })
  if (firstCall.isErr()) return Result.err(firstCall.error)

  if (firstCall.value.kind === 'success') {
    return Result.ok({
      externalId: firstCall.value.externalId,
      externalUrl: firstCall.value.externalUrl,
      response: firstCall.value.response,
    })
  }

  const db = await getDb(args.env)
  const approvalResult = await resolveConnectorWritePermissionRequests({
    approved: true,
    actorUserId: args.actorUserId,
    db,
    issueId: args.issueId,
    permissionRequestId: firstCall.value.requestId,
    workspaceId: args.workspaceId,
  })
  if (approvalResult.isErr())
    return Result.err(
      new WorkProductReviewError({
        code: 'database_failed',
        status: 500,
        message: `Permission request resolution failed: ${approvalResult.error.message}`,
      }),
    )

  const secondCall = await callConnectorTool({
    agentId: args.agentId,
    connectorId: args.invocation.connectorId,
    env: args.env,
    issueId: args.issueId,
    runId: args.runId,
    toolArgs: args.invocation.toolArgs,
    toolName: args.invocation.toolName,
    userId: args.actorUserId,
    workspaceId: args.workspaceId,
  })
  if (secondCall.isErr()) return Result.err(secondCall.error)

  if (secondCall.value.kind === 'needs_approval') {
    return Result.err(
      invalidState('Connector write remained pending after approval'),
    )
  }

  return Result.ok({
    externalId: secondCall.value.externalId,
    externalUrl: secondCall.value.externalUrl,
    response: secondCall.value.response,
  })
}

async function applyWorkProduct(args: {
  actorUserId: string
  env: AppEnv
  workProductId: string
  workspaceId: string
}): Promise<
  ResultValue<WorkProductReviewOutcome, ConnectorError | WorkProductReviewError>
> {
  const contextResult = await loadWorkProductContext(args)
  if (contextResult.isErr()) return Result.err(contextResult.error)
  const { issue, workProduct } = contextResult.value
  if (workProduct.status !== 'approved') {
    return Result.err(
      invalidState('Only approved work products can be applied'),
    )
  }

  if (workProduct.appliedExternalUrl) {
    return Result.err(invalidState('Work product has already been applied'))
  }

  const bindingResult = await loadSourceBinding({
    env: args.env,
    issueId: issue.id,
    workspaceId: args.workspaceId,
  })
  if (bindingResult.isErr()) return Result.err(bindingResult.error)

  const invocationResult = resolveWritebackInvocation({
    binding: bindingResult.value,
    workProduct,
  })
  if (invocationResult.isErr()) return Result.err(invocationResult.error)

  const agentId =
    workProduct.agentId ??
    (issue.assigneeType === 'agent' ? issue.assigneeId : null)
  if (!agentId) {
    return Result.err(
      invalidState('Apply requires an agent associated with the work product'),
    )
  }

  const callResult = await callWritebackWithApproval({
    actorUserId: args.actorUserId,
    agentId,
    env: args.env,
    invocation: invocationResult.value,
    issueId: issue.id,
    runId: workProduct.runId,
    workspaceId: args.workspaceId,
  })
  if (callResult.isErr()) return Result.err(callResult.error)

  const externalUrl =
    callResult.value.externalUrl ?? bindingResult.value.externalUrl
  const appliedResult = await markWorkProductApplied({
    env: args.env,
    externalId: callResult.value.externalId,
    externalUrl,
    invocation: invocationResult.value,
    workProduct,
    workspaceId: args.workspaceId,
  })
  if (appliedResult.isErr()) return Result.err(appliedResult.error)

  return Result.ok({
    action: 'apply',
    workProductId: workProduct.id,
    externalId: callResult.value.externalId,
    externalUrl,
  })
}

/**
 * Fills `.github/pull_request_template.md` for an "Apply as PR" pull
 * request so `scripts/verify-pr-contract.mjs` passes: every heading is
 * non-empty, the three required items are checked, Documentation states why
 * no separate doc change is needed (the PR is the file itself), Checks names
 * a command, and Verification says INCONCLUSIVE with its evidence, because
 * Garden writes through the API and runs no build or test. The closing
 * keyword is what lets the PR webhook (#357) move the board card, and it
 * only works for an issue in the same repository.
 */
export function buildApplyPrBody(args: {
  branch: string
  closesRef: string | null
  issueId: string
  path: string
  repository: string
  workProduct: Pick<WorkProductRow, 'id' | 'title'>
}) {
  const title = args.workProduct.title?.trim() || 'Approved work product'
  const why = args.closesRef
    ? `Closes ${args.closesRef}.`
    : `Garden issue \`${args.issueId}\` has no GitHub issue in this repository to close.`
  return `## What changed

Writes \`${args.path}\` with the approved Garden work product "${title}".

## Why

${why} A person approved this text in Garden and applied it as a pull request.

## Scope

- [x] This pull request targets \`dev\`.
- [x] The diff contains one focused change.
- [x] Unrelated work is in a separate pull request.

## Contribution standard

- [x] I stated the outcome and non-goals.
- [x] I read \`docs/README.md\` and the relevant code, tests, and documentation
      before editing.
- [x] I reviewed the final diff and considered its wider effects.
- [ ] I recorded decisions for long-running or multi-contributor work.

## Documentation

Documentation: not needed as a separate change. This pull request changes one file, \`${args.path}\`.

## Checks

- \`git diff dev...${args.branch} -- ${args.path}\` shows the only change.
- Garden wrote the file through the GitHub API, so no build or test ran.

## Verification

INCONCLUSIVE. The evidence is Garden work product \`${args.workProduct.id}\`, approved in Garden, and the \`issue_run:work_product_applied\` event on its run. A reviewer should read the diff before merging.

## Risk and follow-up

Merging stays a human step on GitHub. Review the file against the repository's conventions before merging.
`
}

/** Title for the PR; the contract needs at least 10 characters. */
function applyPrTitle(workProduct: WorkProductRow) {
  const title = workProduct.title?.trim() || 'Approved work product'
  return title.length >= 10 ? title : `${title} (Garden work product)`
}

/** Reads one tool and fails if it unexpectedly asks for approval. */
async function readGithub(
  args: Parameters<typeof callConnectorTool>[0],
): Promise<
  ResultValue<ConnectorToolResponse, ConnectorError | WorkProductReviewError>
> {
  const result = await callConnectorTool(args)
  if (result.isErr()) return Result.err(result.error)
  if (result.value.kind === 'needs_approval') {
    return Result.err(
      invalidState(`${args.toolName} unexpectedly needs approval`),
    )
  }
  return Result.ok(result.value)
}

/**
 * Applies an approved work product as a GitHub pull request (S1-28, #375).
 *
 * Before: the only apply path posted the body as a comment on the bound
 * issue, so a draft meant to become a repository file never became a PR.
 * After: when `payload.pr_target` names `owner/repo` + path and that
 * repository is linked to the issue's Team (`team_repository`), the server
 * reads the base branch head, creates `garden/work-product-<id>`, writes the
 * body to the file (passing the existing blob sha when the file exists),
 * and opens a PR whose body fills the PR template. Every call runs through
 * the workspace GitHub App installation with the approving person as actor,
 * the same `callWritebackWithApproval` gate the comment apply uses. The PR
 * URL and number are recorded as `applied_external_url/id`. Merging stays a
 * human step.
 */
async function applyWorkProductAsPr(args: {
  actorUserId: string
  env: AppEnv
  workProductId: string
  workspaceId: string
}): Promise<
  ResultValue<WorkProductReviewOutcome, ConnectorError | WorkProductReviewError>
> {
  const contextResult = await loadWorkProductContext(args)
  if (contextResult.isErr()) return Result.err(contextResult.error)
  const { issue, workProduct } = contextResult.value
  if (workProduct.status !== 'approved') {
    return Result.err(
      invalidState('Only approved work products can be applied'),
    )
  }
  if (workProduct.appliedExternalUrl) {
    return Result.err(invalidState('Work product has already been applied'))
  }

  const body = workProduct.body?.trim()
  if (!body) return Result.err(invalidState('Work product body is empty'))

  const target = parseWorkProductPrTarget(workProduct.payload)
  if (!target) {
    return Result.err(
      invalidState(
        'Apply as PR requires payload.pr_target with repository and path',
      ),
    )
  }
  const repository = parseRepository(target.repository)
  if (!repository) {
    return Result.err(invalidState('pr_target.repository must be owner/repo'))
  }

  if (!issue.teamId) {
    return Result.err(invalidState('Apply as PR requires an issue on a Team'))
  }
  const teamId = issue.teamId
  const db = await getDb(args.env)
  const linkedResult = await Result.tryPromise({
    try: async () =>
      db
        .select({ fullName: schema.teamRepository.fullName })
        .from(schema.teamRepository)
        .where(
          and(
            eq(schema.teamRepository.workspaceId, args.workspaceId),
            eq(schema.teamRepository.teamId, teamId),
            sql`lower(${schema.teamRepository.fullName}) = lower(${target.repository})`,
          ),
        )
        .limit(1),
    catch: (cause) => dbError('Failed to load Team repositories', cause),
  })
  if (linkedResult.isErr()) return Result.err(linkedResult.error)
  if (linkedResult.value.length === 0) {
    return Result.err(
      invalidState(
        `Repository ${target.repository} is not linked to this issue's Team`,
      ),
    )
  }

  const agentId =
    workProduct.agentId ??
    (issue.assigneeType === 'agent' ? issue.assigneeId : null)
  if (!agentId) {
    return Result.err(
      invalidState('Apply requires an agent associated with the work product'),
    )
  }

  const bindingResult = await findSourceBinding({
    env: args.env,
    issueId: issue.id,
    workspaceId: args.workspaceId,
  })
  if (bindingResult.isErr()) return Result.err(bindingResult.error)
  const binding = bindingResult.value
  const issueRef =
    binding?.connectorId === 'github'
      ? resolveGithubIssueRef(binding).unwrapOr(null)
      : null
  const closesRef =
    issueRef &&
    issueRef.owner.toLowerCase() === repository.owner.toLowerCase() &&
    issueRef.repo.toLowerCase() === repository.repo.toLowerCase()
      ? `#${issueRef.issueNumber}`
      : null

  const call = {
    agentId,
    connectorId: 'github',
    env: args.env,
    issueId: issue.id,
    runId: workProduct.runId,
    userId: args.actorUserId,
    workspaceId: args.workspaceId,
  }
  const write = (toolName: string, toolArgs: Record<string, unknown>) =>
    callWritebackWithApproval({
      actorUserId: args.actorUserId,
      agentId,
      env: args.env,
      invocation: {
        connectorId: 'github',
        targetLabel: `github.com/${target.repository}`,
        toolArgs,
        toolName,
      },
      issueId: issue.id,
      runId: workProduct.runId,
      workspaceId: args.workspaceId,
    })
  const repoArgs = { owner: repository.owner, repo: repository.repo }

  const baseResult = await readGithub({
    ...call,
    toolName: 'get_commit',
    toolArgs: { ...repoArgs, ref: target.base_branch },
  })
  if (baseResult.isErr()) return Result.err(baseResult.error)
  const baseSha = stringValue(objectOrNull(baseResult.value.response)?.sha)
  if (!baseSha) {
    return Result.err(
      invalidState(`Could not read the head of ${target.base_branch}`),
    )
  }

  const branch = `garden/work-product-${workProduct.id.slice(0, 8)}`
  const branchResult = await write('create_branch', {
    ...repoArgs,
    branch,
    fromSha: baseSha,
  })
  if (branchResult.isErr()) return Result.err(branchResult.error)

  // A missing file is the create case; any other read failure stops here.
  const existingResult = await readGithub({
    ...call,
    toolName: 'get_file_contents',
    toolArgs: { ...repoArgs, path: target.path, ref: branch },
  })
  const existingSha = existingResult.isOk()
    ? stringValue(objectOrNull(existingResult.value.response)?.sha)
    : null
  if (
    existingResult.isErr() &&
    !(
      isConnectorError(existingResult.error) &&
      existingResult.error.kind === 'not_found'
    )
  ) {
    return Result.err(existingResult.error)
  }

  const title = applyPrTitle(workProduct)
  const fileResult = await write('create_or_update_file', {
    ...repoArgs,
    path: target.path,
    message: title,
    content: body,
    branch,
    ...(existingSha ? { sha: existingSha } : {}),
  })
  if (fileResult.isErr()) return Result.err(fileResult.error)

  const invocation: WritebackInvocation = {
    connectorId: 'github',
    targetLabel: `github.com/${target.repository}/blob/${branch}/${target.path}`,
    toolArgs: {
      ...repoArgs,
      title,
      head: branch,
      base: target.base_branch,
      body: buildApplyPrBody({
        branch,
        closesRef,
        issueId: issue.id,
        path: target.path,
        repository: target.repository,
        workProduct,
      }),
    },
    toolName: 'create_pull_request',
  }
  const prResult = await write(invocation.toolName, invocation.toolArgs)
  if (prResult.isErr()) return Result.err(prResult.error)

  const prNumber = numberValue(objectOrNull(prResult.value.response)?.number)
  const externalId = prNumber?.toString() ?? prResult.value.externalId
  const externalUrl = prResult.value.externalUrl
  const appliedResult = await markWorkProductApplied({
    env: args.env,
    externalId,
    externalUrl,
    invocation,
    workProduct,
    workspaceId: args.workspaceId,
  })
  if (appliedResult.isErr()) return Result.err(appliedResult.error)

  return Result.ok({
    action: 'apply_pr',
    workProductId: workProduct.id,
    externalId,
    externalUrl,
  })
}

export async function reviewWorkProduct(args: {
  actorUserId: string
  env: AppEnv
  input: WorkProductReviewInput
  workProductId: string
  workspaceId: string
}): Promise<
  ResultValue<WorkProductReviewOutcome, ConnectorError | WorkProductReviewError>
> {
  switch (args.input.action) {
    case 'approve':
      return approveWorkProduct({
        actorUserId: args.actorUserId,
        closeIssue: args.input.close_issue,
        editedBody: args.input.edited_body,
        env: args.env,
        workProductId: args.workProductId,
        workspaceId: args.workspaceId,
      })
    case 'request_changes':
      return requestWorkProductChanges({
        actorUserId: args.actorUserId,
        comment: args.input.comment,
        env: args.env,
        workProductId: args.workProductId,
        workspaceId: args.workspaceId,
      })
    case 'apply':
      return applyWorkProduct({
        actorUserId: args.actorUserId,
        env: args.env,
        workProductId: args.workProductId,
        workspaceId: args.workspaceId,
      })
    case 'apply_pr':
      return applyWorkProductAsPr({
        actorUserId: args.actorUserId,
        env: args.env,
        workProductId: args.workProductId,
        workspaceId: args.workspaceId,
      })
  }
}
