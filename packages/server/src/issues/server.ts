import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getPooledDb } from '@garden/db/runtime'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { formatIssueIdentifier } from '@garden/core/issues/identifier'
import { LIVE_RUN_STATUSES, WAKEUP_DEDUPING_RUN_STATUSES } from '@garden/core/issues/run-sync'
import { decideWakeups } from '@garden/core/issues/triggers'
import { createLogger } from '@garden/observability/console'
import type { Comment } from '@garden/core/types/comment'
import type { Issue, IssueAssigneeType, IssueStatus } from '@garden/core/types/issue'

const logger = createLogger('issues')
import * as schema from '@garden/db/schema'
import {
  issueCommentInsertSchema,
  issueInsertSchema,
  issuePrioritySchema,
  issueSourceBindingInsertSchema,
  issueStatusSchema,
} from '@garden/db/validation'
import { z } from 'zod'
import {
  attachSourceBindingInTransaction,
  type AttachSourceBindingInput,
} from '@garden/core/issues/source-binding'
import { startIssueRun, type IssueRunEnv } from './run-service'

const MENTION_PATTERN = /@([A-Za-z0-9._-]+)/g

export class IssueServiceError extends TaggedError('IssueServiceError')<{
  code: 'issue_not_found' | 'validation_failed' | 'db_error'
  message: string
  cause?: unknown
}>() {}

const sourceInputSchema = z
  .object({
    connectorId: issueSourceBindingInsertSchema.shape.connectorId,
    sourceKind: issueSourceBindingInsertSchema.shape.sourceKind,
    externalId: issueSourceBindingInsertSchema.shape.externalId,
    externalUrl: z.string().trim().min(1).optional().nullable(),
  })
  .strict()

const createIssueInputSchema = z
  .object({
    databaseUrl: z.string().trim().min(1),
    workspaceId: issueInsertSchema.shape.workspaceId,
    title: issueInsertSchema.shape.title,
    description: z.string().optional().nullable(),
    status: issueStatusSchema.optional(),
    priority: issuePrioritySchema.optional(),
    createdBy: issueInsertSchema.shape.createdBy,
    assigneeType: z.enum(['user', 'agent']).optional().nullable(),
    assigneeId: issueInsertSchema.shape.assigneeId.optional().nullable(),
    parentId: issueInsertSchema.shape.parentId.optional().nullable(),
    projectId: issueInsertSchema.shape.projectId.optional().nullable(),
    dueDate: z.date().optional().nullable(),
    source: sourceInputSchema.optional(),
  })
  .strict()

const readIssueInputSchema = z
  .object({
    databaseUrl: z.string().trim().min(1),
    workspaceId: issueInsertSchema.shape.workspaceId,
    issueIdOrIdentifier: z.string().trim().min(1),
  })
  .strict()

const listIssuesInputSchema = z
  .object({
    databaseUrl: z.string().trim().min(1),
    workspaceId: issueInsertSchema.shape.workspaceId,
    ownerUserId: issueInsertSchema.shape.createdBy,
    assigneeAgentId: issueInsertSchema.shape.assigneeId.optional(),
    status: issueStatusSchema.optional(),
    mine: z.boolean().optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict()

const postIssueCommentInputSchema = z
  .object({
    databaseUrl: z.string().trim().min(1),
    workspaceId: issueInsertSchema.shape.workspaceId,
    issueIdOrIdentifier: z.string().trim().min(1),
    authorUserId: issueCommentInsertSchema.shape.authorId,
    body: issueCommentInsertSchema.shape.body,
    parentId: issueCommentInsertSchema.shape.id.optional().nullable(),
  })
  .strict()

export type CreateIssueInput = z.infer<typeof createIssueInputSchema>
export type ReadIssueInput = z.infer<typeof readIssueInputSchema>
export type ListIssuesInput = z.infer<typeof listIssuesInputSchema>
export type PostIssueCommentInput = z.infer<typeof postIssueCommentInputSchema> & {
  issueRunEnv: IssueRunEnv
}

type IssueCommentWakeupInput = {
  databaseUrl: string
  issueRunEnv: IssueRunEnv
  workspaceId: string
  issueId: string
  comment: {
    id: string
    authorType: 'user' | 'agent'
    authorId: string
    body: string
    parentId?: string | null
  }
  mentionedAgentIds?: string[]
  actor: { type: 'member' | 'agent' | 'system'; id: string }
}

type IssueDb = ReturnType<typeof getIssueDb>

type IssueRunSummary = {
  run_id: string
  agent_id: string
  status: string
  started_at: string | null
}

export type IssueSummary = {
  issue_id: string
  identifier: string
  title: string
  status: IssueStatus
  assignee: {
    type: 'member' | 'agent'
    id: string
    name: string | null
  } | null
  active_run: IssueRunSummary | null
  last_event: {
    event_type: string
    message: string | null
    created_at: string
  } | null
  work_products_summary: Array<{
    id: string
    type: string
    title: string
    status: string
  }>
  blocked_reason?: string | null
}

/**
 * Resolves the issue read/write Drizzle client through Hyperdrive's pooled
 * connection string. Callers pass `env.HYPERDRIVE.connectionString`. Previously
 * called `drizzle(databaseUrl)` from the neon-serverless driver, opening a fresh
 * direct-to-Neon WebSocket pool per call that bypassed Hyperdrive, never closed,
 * and defeated Neon autosuspend. `getPooledDb` memoizes one node-postgres pool
 * per connection string per isolate so Hyperdrive owns origin pooling.
 */
export function getIssueDb(databaseUrl: string) {
  return getPooledDb(databaseUrl)
}

function serviceDbError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new IssueServiceError({
    code: 'db_error',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

function validationError(message: string) {
  return new IssueServiceError({
    code: 'validation_failed',
    message,
  })
}

function dateToIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

export function toIssue(
  record: typeof schema.issue.$inferSelect,
  options: { issuePrefix: string },
): Issue {
  const sourceSummary = record.sourceSummary
    ? {
        connector_id: 'manual',
        display_ref: record.sourceSummary,
        external_url: null,
      }
    : null

  return {
    id: record.id,
    workspace_id: record.workspaceId,
    number: record.number,
    identifier: formatIssueIdentifier(options.issuePrefix, record.number),
    title: record.title,
    description: record.description ?? null,
    status: (record.status ?? 'backlog') as IssueStatus,
    priority: record.priority as Issue['priority'],
    assignee_type: (record.assigneeType === 'user'
      ? 'member'
      : record.assigneeType) as IssueAssigneeType | null,
    assignee_id: record.assigneeId ?? null,
    creator_type: 'member',
    creator_id: record.createdBy,
    parent_issue_id: record.parentId ?? null,
    project_id: record.projectId ?? null,
    position: record.position,
    due_date: dateToIso(record.dueDate),
    active_run_id: record.activeRunId ?? null,
    source_summary: sourceSummary,
    reactions: [],
    created_at: dateToIso(record.createdAt) ?? new Date().toISOString(),
    updated_at: dateToIso(record.updatedAt) ?? new Date().toISOString(),
  }
}

export function toIssueComment(
  row: typeof schema.issueComment.$inferSelect,
): Comment {
  const createdAt = (row.createdAt ?? new Date()).toISOString()

  return {
    id: row.id,
    issue_id: row.issueId,
    author_type: (row.authorType === 'agent'
      ? 'agent'
      : 'member') as Comment['author_type'],
    author_id: row.authorId,
    content: row.body,
    type: 'comment',
    parent_id: null,
    reactions: [],
    attachments: [],
    created_at: createdAt,
    updated_at: createdAt,
  }
}

function normalizeMention(value: string) {
  return value.trim().toLowerCase()
}

function mentionAliases(value: { name?: string | null; email?: string | null }) {
  const aliases = new Set<string>()
  if (value.name) {
    aliases.add(normalizeMention(value.name))
    aliases.add(normalizeMention(value.name.replace(/\s+/g, '')))
  }
  if (value.email) {
    aliases.add(normalizeMention(value.email))
    aliases.add(normalizeMention(value.email.split('@')[0] ?? ''))
  }
  aliases.delete('')
  return aliases
}

function hasMentionToken(aliases: Set<string>, tokens: Set<string>) {
  for (const alias of aliases) {
    if (tokens.has(alias)) return true
  }
  return false
}

function extractMentionTokens(content: string) {
  return new Set(
    [...content.matchAll(MENTION_PATTERN)].map((match) =>
      normalizeMention(match[1] ?? ''),
    ),
  )
}

async function resolveMentions(args: {
  db: IssueDb
  workspaceId: string
  content: string
}) {
  const tokens = extractMentionTokens(args.content)
  if (tokens.size === 0) return { agents: [] as string[], users: [] as string[] }

  const [agentRows, memberRows] = await Promise.all([
    args.db
      .select({
        id: schema.agent.id,
        name: schema.agent.name,
      })
      .from(schema.agent)
      .where(
        and(
          eq(schema.agent.workspaceId, args.workspaceId),
          inArray(schema.agent.status, ['active', 'pending_approval']),
        ),
      ),
    args.db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, args.workspaceId)),
  ])

  const agents = agentRows
    .filter((agent) => hasMentionToken(mentionAliases({ name: agent.name }), tokens))
    .map((agent) => agent.id)
  const users = memberRows
    .filter((member) =>
      hasMentionToken(
        mentionAliases({ name: member.name, email: member.email }),
        tokens,
      ),
    )
    .map((member) => member.id)

  return {
    agents: [...new Set(agents)],
    users: [...new Set(users)],
  }
}

function mentionsJson(mentions: { agents: string[]; users: string[] }) {
  return mentions.agents.length > 0 || mentions.users.length > 0
    ? mentions
    : null
}

function parseIssueIdentifier(value: string) {
  const match = /^[A-Z0-9]{2,8}-(\d+)$/i.exec(value.trim())
  const numberText = match?.[1]
  if (!numberText) return null
  const issueNumber = Number(numberText)
  return Number.isSafeInteger(issueNumber) ? issueNumber : null
}

async function resolveIssue(
  db: IssueDb,
  workspaceId: string,
  issueIdOrIdentifier: string,
) {
  const issueNumber = parseIssueIdentifier(issueIdOrIdentifier)
  const trimmed = issueIdOrIdentifier.trim()
  const issueUuid = z.string().uuid().safeParse(trimmed)

  const conditions =
    issueNumber !== null
      ? and(
          eq(schema.issue.workspaceId, workspaceId),
          eq(schema.issue.number, issueNumber),
        )
      : issueUuid.success
        ? and(
            eq(schema.issue.workspaceId, workspaceId),
            eq(schema.issue.id, issueUuid.data),
          )
        : undefined

  if (!conditions) return null
  const [issue] = await db.select().from(schema.issue).where(conditions).limit(1)
  return issue ?? null
}

async function loadIssuePrefix(db: IssueDb, workspaceId: string) {
  const [workspace] = await db
    .select({ issuePrefix: schema.organization.issuePrefix })
    .from(schema.organization)
    .where(eq(schema.organization.id, workspaceId))
    .limit(1)
  if (!workspace) {
    throw new IssueServiceError({
      code: 'db_error',
      message: 'Workspace not found while loading issue prefix',
    })
  }
  return workspace.issuePrefix
}

async function issueAssigneeSummary(
  db: IssueDb,
  issue: typeof schema.issue.$inferSelect,
): Promise<IssueSummary['assignee']> {
  if (!issue.assigneeType || !issue.assigneeId) return null

  if (issue.assigneeType === 'agent') {
    const [agent] = await db
      .select({ id: schema.agent.id, name: schema.agent.name })
      .from(schema.agent)
      .where(eq(schema.agent.id, issue.assigneeId))
      .limit(1)
    return agent ? { type: 'agent', id: agent.id, name: agent.name } : null
  }

  const [user] = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, issue.assigneeId))
    .limit(1)
  return user ? { type: 'member', id: user.id, name: user.name } : null
}

async function activeRunSummary(
  db: IssueDb,
  issue: typeof schema.issue.$inferSelect,
): Promise<IssueRunSummary | null> {
  const runConditions = issue.activeRunId
    ? and(
        eq(schema.issueRun.id, issue.activeRunId),
        eq(schema.issueRun.workspaceId, issue.workspaceId),
      )
    : and(
        eq(schema.issueRun.issueId, issue.id),
        inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
      )

  const [run] = await db
    .select({
      id: schema.issueRun.id,
      agentId: schema.issueRun.agentId,
      status: schema.issueRun.status,
      startedAt: schema.issueRun.startedAt,
    })
    .from(schema.issueRun)
    .where(runConditions)
    .orderBy(desc(schema.issueRun.createdAt))
    .limit(1)

  return run
    ? {
        run_id: run.id,
        agent_id: run.agentId,
        status: run.status,
        started_at: dateToIso(run.startedAt),
      }
    : null
}

async function latestIssueEvent(
  db: IssueDb,
  issue: typeof schema.issue.$inferSelect,
  activeRun: IssueRunSummary | null,
): Promise<IssueSummary['last_event']> {
  const eventConditions = activeRun
    ? and(
        eq(schema.issueRunEvent.workspaceId, issue.workspaceId),
        eq(schema.issueRunEvent.runId, activeRun.run_id),
      )
    : and(
        eq(schema.issueRunEvent.workspaceId, issue.workspaceId),
        eq(schema.issueRunEvent.issueId, issue.id),
      )

  const [event] = await db
    .select({
      eventType: schema.issueRunEvent.eventType,
      message: schema.issueRunEvent.message,
      createdAt: schema.issueRunEvent.createdAt,
    })
    .from(schema.issueRunEvent)
    .where(eventConditions)
    .orderBy(desc(schema.issueRunEvent.createdAt), desc(schema.issueRunEvent.seq))
    .limit(1)

  return event
    ? {
        event_type: event.eventType,
        message: event.message ?? null,
        created_at: dateToIso(event.createdAt) ?? new Date().toISOString(),
      }
    : null
}

async function workProductsSummary(db: IssueDb, issueId: string) {
  const rows = await db
    .select({
      id: schema.issueWorkProduct.id,
      type: schema.issueWorkProduct.type,
      title: schema.issueWorkProduct.title,
      status: schema.issueWorkProduct.status,
    })
    .from(schema.issueWorkProduct)
    .where(eq(schema.issueWorkProduct.issueId, issueId))
    .orderBy(desc(schema.issueWorkProduct.updatedAt))
    .limit(10)

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title ?? row.type,
    status: row.status,
  }))
}

async function blockedReason(
  db: IssueDb,
  issue: typeof schema.issue.$inferSelect,
) {
  if (issue.status !== 'blocked') return null
  const [run] = await db
    .select({ error: schema.issueRun.error })
    .from(schema.issueRun)
    .where(eq(schema.issueRun.issueId, issue.id))
    .orderBy(desc(schema.issueRun.createdAt))
    .limit(1)
  return run?.error ?? null
}

async function toIssueSummary(
  db: IssueDb,
  issue: typeof schema.issue.$inferSelect,
  options: { issuePrefix: string },
): Promise<IssueSummary> {
  const assignee = await issueAssigneeSummary(db, issue)
  const activeRun = await activeRunSummary(db, issue)
  const [lastEvent, products, reason] = await Promise.all([
    latestIssueEvent(db, issue, activeRun),
    workProductsSummary(db, issue.id),
    blockedReason(db, issue),
  ])

  return {
    issue_id: issue.id,
    identifier: formatIssueIdentifier(options.issuePrefix, issue.number),
    title: issue.title,
    status: (issue.status ?? 'backlog') as IssueStatus,
    assignee,
    active_run: activeRun,
    last_event: lastEvent,
    work_products_summary: products,
    ...(reason ? { blocked_reason: reason } : {}),
  }
}

export async function createIssue(
  input: CreateIssueInput,
): Promise<ResultValue<Issue, IssueServiceError>> {
  const parsed = createIssueInputSchema.safeParse(input)
  if (!parsed.success) {
    return Result.err(validationError(parsed.error.issues[0]?.message ?? 'Invalid issue.'))
  }

  const db = getIssueDb(parsed.data.databaseUrl)
  const result = await Result.tryPromise({
    try: async () =>
      await db.transaction(async (tx) => {
        const [{ nextNumber }] = (await tx
          .select({
            nextNumber: sql<number>`cast(coalesce(max(${schema.issue.number}), 0) + 1 as int)`,
          })
          .from(schema.issue)
          .where(eq(schema.issue.workspaceId, parsed.data.workspaceId))) as [
          { nextNumber: number },
        ]

        const [insertedIssue] = await tx
          .insert(schema.issue)
          .values({
            id: crypto.randomUUID(),
            workspaceId: parsed.data.workspaceId,
            number: nextNumber,
            title: parsed.data.title,
            description: parsed.data.description ?? null,
            status: parsed.data.status ?? 'backlog',
            priority: parsed.data.priority ?? 'medium',
            createdBy: parsed.data.createdBy,
            assigneeType: parsed.data.assigneeType ?? null,
            assigneeId: parsed.data.assigneeId ?? null,
            parentId: parsed.data.parentId ?? null,
            projectId: parsed.data.projectId ?? null,
            dueDate: parsed.data.dueDate ?? null,
          })
          .returning()
        if (!insertedIssue) {
          throw new IssueServiceError({
            code: 'db_error',
            message: 'Issue insert returned no row',
          })
        }
        const issue = insertedIssue

        if (parsed.data.source) {
          await attachSourceBindingInTransaction(tx, {
            workspaceId: parsed.data.workspaceId,
            issueId: issue.id,
            connectorId: parsed.data.source.connectorId,
            sourceKind: parsed.data.source.sourceKind,
            externalId: parsed.data.source.externalId,
            externalUrl: parsed.data.source.externalUrl,
          } satisfies Omit<AttachSourceBindingInput, 'databaseUrl'>)
        }

        return issue
      }),
    catch: (cause) => serviceDbError('create issue', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  const prefixResult = await Result.tryPromise({
    try: async () => await loadIssuePrefix(db, parsed.data.workspaceId),
    catch: (cause) => serviceDbError('load issue prefix', cause),
  })
  if (prefixResult.isErr()) return Result.err(prefixResult.error)
  return Result.ok(toIssue(result.value, { issuePrefix: prefixResult.value }))
}

export async function readIssue(
  input: ReadIssueInput,
): Promise<ResultValue<IssueSummary, IssueServiceError>> {
  const parsed = readIssueInputSchema.safeParse(input)
  if (!parsed.success) {
    return Result.err(validationError(parsed.error.issues[0]?.message ?? 'Invalid issue lookup.'))
  }

  const db = getIssueDb(parsed.data.databaseUrl)
  const result = await Result.tryPromise({
    try: async () => {
      const issueNumber = parseIssueIdentifier(parsed.data.issueIdOrIdentifier)
      const issueUuid = z
        .string()
        .uuid()
        .safeParse(parsed.data.issueIdOrIdentifier.trim())
      const issueCondition =
        issueNumber !== null
          ? eq(schema.issue.number, issueNumber)
          : issueUuid.success
            ? eq(schema.issue.id, issueUuid.data)
            : undefined
      if (!issueCondition) return null

      const [issue] = await db
        .select({ issue: schema.issue, issuePrefix: schema.organization.issuePrefix })
        .from(schema.issue)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.issue.workspaceId),
        )
        .where(
          and(
            eq(schema.issue.workspaceId, parsed.data.workspaceId),
            issueCondition,
          ),
        )
        .limit(1)
      if (!issue) return null
      return await toIssueSummary(db, issue.issue, {
        issuePrefix: issue.issuePrefix,
      })
    },
    catch: (cause) => serviceDbError('read issue', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  if (!result.value) {
    return Result.err(
      new IssueServiceError({
        code: 'issue_not_found',
        message: 'Issue not found.',
      }),
    )
  }
  return Result.ok(result.value)
}

export async function listIssues(
  input: ListIssuesInput,
): Promise<ResultValue<IssueSummary[], IssueServiceError>> {
  const parsed = listIssuesInputSchema.safeParse(input)
  if (!parsed.success) {
    return Result.err(validationError(parsed.error.issues[0]?.message ?? 'Invalid issue list query.'))
  }

  const db = getIssueDb(parsed.data.databaseUrl)
  const result = await Result.tryPromise({
    try: async () => {
      const conditions = [eq(schema.issue.workspaceId, parsed.data.workspaceId)]
      if (parsed.data.status) {
        conditions.push(eq(schema.issue.status, parsed.data.status))
      }
      if (parsed.data.assigneeAgentId) {
        conditions.push(eq(schema.issue.assigneeType, 'agent'))
        conditions.push(eq(schema.issue.assigneeId, parsed.data.assigneeAgentId))
      } else if (parsed.data.mine) {
        conditions.push(eq(schema.issue.assigneeType, 'user'))
        conditions.push(eq(schema.issue.assigneeId, parsed.data.ownerUserId))
      }

      const issues = await db
        .select({ issue: schema.issue, issuePrefix: schema.organization.issuePrefix })
        .from(schema.issue)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.issue.workspaceId),
        )
        .where(and(...conditions))
        .orderBy(desc(schema.issue.updatedAt), desc(schema.issue.createdAt))
        .limit(parsed.data.limit ?? 20)

      return await Promise.all(
        issues.map((row) =>
          toIssueSummary(db, row.issue, { issuePrefix: row.issuePrefix }),
        ),
      )
    },
    catch: (cause) => serviceDbError('list issues', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value)
}

export async function postIssueComment(
  input: PostIssueCommentInput,
): Promise<ResultValue<{ comment_id: string; comment: Comment }, IssueServiceError>> {
  const { issueRunEnv, ...rawInput } = input
  const parsed = postIssueCommentInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return Result.err(validationError(parsed.error.issues[0]?.message ?? 'Invalid issue comment.'))
  }

  const db = getIssueDb(parsed.data.databaseUrl)
  const result = await Result.tryPromise({
    try: async () => {
      const issue = await resolveIssue(
        db,
        parsed.data.workspaceId,
        parsed.data.issueIdOrIdentifier,
      )
      if (!issue) return { kind: 'missing' as const }

      const mentions = await resolveMentions({
        db,
        workspaceId: parsed.data.workspaceId,
        content: parsed.data.body,
      })
      const [insertedComment] = await db
        .insert(schema.issueComment)
        .values({
          id: crypto.randomUUID(),
          issueId: issue.id,
          authorType: 'user',
          authorId: parsed.data.authorUserId,
          body: parsed.data.body,
          mentions: mentionsJson(mentions),
        })
        .returning()

      if (!insertedComment) {
        throw new IssueServiceError({
          code: 'db_error',
          message: 'Comment insert returned no row',
        })
      }
      const comment = insertedComment
      return {
        kind: 'posted' as const,
        comment,
        issueId: issue.id,
        mentionedAgentIds: mentions.agents,
      }
    },
    catch: (cause) => serviceDbError('post issue comment', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  if (result.value.kind === 'missing') {
    return Result.err(
      new IssueServiceError({
        code: 'issue_not_found',
        message: 'Issue not found.',
      }),
    )
  }
  const wakeResult = await wakeAgentsForIssueComment({
    databaseUrl: parsed.data.databaseUrl,
    issueRunEnv,
    workspaceId: parsed.data.workspaceId,
    issueId: result.value.issueId,
    comment: {
      id: result.value.comment.id,
      authorType: result.value.comment.authorType as 'user' | 'agent',
      authorId: result.value.comment.authorId,
      body: result.value.comment.body,
      parentId: parsed.data.parentId ?? null,
    },
    mentionedAgentIds: result.value.mentionedAgentIds,
    actor: { type: 'member', id: parsed.data.authorUserId },
  })
  if (wakeResult.isErr()) return Result.err(wakeResult.error)

  return Result.ok({
    comment_id: result.value.comment.id,
    comment: toIssueComment(result.value.comment),
  })
}

export async function wakeAgentsForIssueComment(
  input: IssueCommentWakeupInput,
): Promise<ResultValue<void, IssueServiceError>> {
  const db = getIssueDb(input.databaseUrl)
  const result = await Result.tryPromise({
    try: async () => {
      const [issue] = await db
        .select({
          id: schema.issue.id,
          workspaceId: schema.issue.workspaceId,
          status: schema.issue.status,
          assigneeType: schema.issue.assigneeType,
          assigneeId: schema.issue.assigneeId,
        })
        .from(schema.issue)
        .where(
          and(
            eq(schema.issue.id, input.issueId),
            eq(schema.issue.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
      if (!issue) return { kind: 'missing' as const }

      const [parentComment] = input.comment.parentId
        ? await db
            .select({
              authorType: schema.issueComment.authorType,
              authorId: schema.issueComment.authorId,
            })
            .from(schema.issueComment)
            .where(
              and(
                eq(schema.issueComment.id, input.comment.parentId),
                eq(schema.issueComment.issueId, input.issueId),
              ),
            )
            .limit(1)
        : []

      const [runningRuns, activeWaitingRun] = await Promise.all([
        db
          .select({ agentId: schema.issueRun.agentId })
          .from(schema.issueRun)
          .where(
            and(
              eq(schema.issueRun.issueId, input.issueId),
              inArray(schema.issueRun.status, WAKEUP_DEDUPING_RUN_STATUSES),
            ),
          ),
        db
          .select({
            id: schema.issueRun.id,
            agentId: schema.issueRun.agentId,
          })
          .from(schema.issueRun)
          .where(
            and(
              eq(schema.issueRun.issueId, input.issueId),
              eq(schema.issueRun.status, 'waiting_for_input'),
            ),
          )
          .orderBy(desc(schema.issueRun.createdAt))
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ])

      const decisions = decideWakeups({
        issue: {
          id: issue.id,
          status: (issue.status ?? 'backlog') as IssueStatus,
          assigneeType:
            issue.assigneeType === 'agent'
              ? 'agent'
              : issue.assigneeType === 'user'
                ? 'member'
                : null,
          assigneeId: issue.assigneeId,
        },
        comment: {
          id: input.comment.id,
          authorType: input.comment.authorType,
          authorId: input.comment.authorId,
          body: input.comment.body,
          parentId: input.comment.parentId ?? null,
        },
        parentComment: parentComment
          ? {
              authorType:
                parentComment.authorType === 'agent' ? 'agent' : 'user',
              authorId: parentComment.authorId,
            }
          : null,
        runningRuns,
        mentionedAgentIds: input.mentionedAgentIds ?? [],
      })

      const startedAgentIds = new Set<string>()
      if (activeWaitingRun) {
        const startResult = await startIssueRun(input.issueRunEnv, {
          workspaceId: input.workspaceId,
          issueId: input.issueId,
          agentId: activeWaitingRun.agentId,
          source: 'comment',
          trigger: { commentId: input.comment.id },
          actor: input.actor,
        })
        startedAgentIds.add(activeWaitingRun.agentId)
        if (startResult.isErr())
          logger.error('startIssueRun failed', startResult.error.message)
      }

      for (const decision of decisions) {
        if (decision.kind !== 'enqueue') continue
        if (startedAgentIds.has(decision.agentId)) continue
        const startResult = await startIssueRun(input.issueRunEnv, {
          workspaceId: input.workspaceId,
          issueId: input.issueId,
          agentId: decision.agentId,
          source: decision.source,
          trigger: { commentId: input.comment.id },
          actor: input.actor,
        })
        if (startResult.isErr())
          logger.error('startIssueRun failed', startResult.error.message)
      }

      return { kind: 'woke' as const }
    },
    catch: (cause) => serviceDbError('wake issue agents', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  if (result.value.kind === 'missing') {
    return Result.err(
      new IssueServiceError({
        code: 'issue_not_found',
        message: 'Issue not found.',
      }),
    )
  }
  return Result.ok()
}
