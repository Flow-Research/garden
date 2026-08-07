import { Effect } from 'effect'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wakeAgentsForIssueComment } from '@garden/server/issues/server'

import {
  classifyConnectorError,
  type ConnectorError,
} from '@garden/core/connectors/errors'
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

export const workProductReviewBodySchema = z
  .object({
    action: z.enum(['approve', 'request_changes', 'apply']),
    edited_body: z.string().optional(),
    comment: z.string().optional(),
  })
  .strict()

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

type ConnectorToolCallOutcome =
  | { kind: 'needs_approval'; requestId: string }
  | ({ kind: 'success' } & ConnectorToolSuccess)

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
      action: 'apply'
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
  const match = value?.match(/^([^/\s]+)\/([^/\s#]+)$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

function parseGithubIssueRefFromText(value: string | null) {
  if (!value) return null

  const urlMatch = value.match(
    /github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)/i,
  )
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      issueNumber: Number(urlMatch[3]),
    } satisfies GithubIssueRef
  }

  const shorthandMatch = value.match(/^([^/\s]+)\/([^#\s]+)#(\d+)$/)
  if (shorthandMatch) {
    return {
      owner: shorthandMatch[1],
      repo: shorthandMatch[2],
      issueNumber: Number(shorthandMatch[3]),
    } satisfies GithubIssueRef
  }

  const pathMatch = value.match(
    /^([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)$/i,
  )
  if (pathMatch) {
    return {
      owner: pathMatch[1],
      repo: pathMatch[2],
      issueNumber: Number(pathMatch[3]),
    } satisfies GithubIssueRef
  }

  return null
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
      // Source: docs/research/issue-flow-plan.md, "Slice 4".
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
  if (
    !installationResult.value ||
    installationResult.value.status === 'disconnected'
  ) {
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
              installationId: installationResult.value.installationId,
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

async function approveWorkProduct(args: {
  actorUserId: string
  editedBody?: string
  env: AppEnv
  workProductId: string
  workspaceId: string
}): Promise<ResultValue<WorkProductReviewOutcome, WorkProductReviewError>> {
  const contextResult = await loadWorkProductContext(args)
  if (contextResult.isErr()) return Result.err(contextResult.error)
  const { workProduct } = contextResult.value
  if (!workProduct.runId) {
    return Result.err(invalidState('Work product is not tied to an issue run'))
  }

  const db = await getDb(args.env)
  const now = new Date()
  const editedBody = args.editedBody
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
          update.payload = sql`
            jsonb_set(
              coalesce(${schema.issueWorkProduct.payload}, '{}'::jsonb),
              '{previous_versions}',
              coalesce(${schema.issueWorkProduct.payload}->'previous_versions', '[]'::jsonb) ||
                jsonb_build_array(jsonb_build_object(
                  'body', ${workProduct.body ?? ''},
                  'replaced_at', ${now.toISOString()},
                  'actor_user_id', ${args.actorUserId}
                )),
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
        const [{ nextSeq }] = await tx
          .select({
            nextSeq: sql<number>`cast(coalesce(max(${schema.issueRunEvent.seq}), 0) + 1 as int)`,
          })
          .from(schema.issueRunEvent)
          .where(eq(schema.issueRunEvent.runId, workProduct.runId as string))
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

async function loadSourceBinding(args: {
  env: AppEnv
  issueId: string
  workspaceId: string
}) {
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
  if (!binding) {
    return Result.err(
      invalidState('Apply requires a connector-bound issue source'),
    )
  }

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
        const [{ nextSeq }] = await tx
          .select({
            nextSeq: sql<number>`cast(coalesce(max(${schema.issueRunEvent.seq}), 0) + 1 as int)`,
          })
          .from(schema.issueRunEvent)
          .where(
            eq(schema.issueRunEvent.runId, args.workProduct.runId as string),
          )
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
  ResultValue<ConnectorToolSuccess, ConnectorError | WorkProductReviewError>
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
  }
}
