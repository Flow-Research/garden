import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import type { ConnectorError } from '@garden/core/connectors/errors'
import type {
  IssueRunEventLevel,
  IssueRunEventStream,
  IssueRunEventType,
  IssueRunStatus,
} from '@garden/core/types/issue-run'
import * as schema from '@garden/db/schema'

export type AgentDoRpcStub = {
  setName?: (name: string) => Promise<void>
  enqueueIssueRun: (input: { runId: string; issueId: string }) => Promise<void>
  cancelIssueRun: (input: { runId: string; issueId: string }) => Promise<void>
}

export type AgentDoNamespace = {
  idFromName: (name: string) => DurableObjectId
  get: (id: DurableObjectId) => AgentDoRpcStub
}

export type IssueRunToolEnv = {
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  DATABASE_URL: string
  AgentDO?: AgentDoNamespace
}

export type IssueRunToolState = {
  runId: string
  workspaceId: string
  issueId: string
  agentId: string
  agentOwnerUserId: string
  hostName: string
  wakeupId: string | null
}

export type IssueRunMcpToolRecord = {
  name: string
  description?: string | null
  inputSchema?: unknown
  outputSchema?: unknown
  serverId: string
}

export type IssueRunMcpBridge = {
  ensureConnections: () => Promise<ResultValue<void, IssueRunToolError>>
  listTools: (filter?: {
    serverId?: string | string[]
  }) => IssueRunMcpToolRecord[]
  callTool: (params: {
    serverId: string
    name: string
    arguments?: Record<string, unknown>
  }) => Promise<unknown>
}

export type IssueRunResolutionAction =
  | 'ask_question'
  | 'create_work_product'
  | 'revise_work_product'
  | 'mark_blocked'
  | 'create_child_issue'

export type IssueRunToolContext = {
  env: IssueRunToolEnv
  storageSql: SqlStorage
  getRunState: () => IssueRunToolState | null
  recordResolution: (action: IssueRunResolutionAction) => void
  mcp?: IssueRunMcpBridge
}

export class IssueRunToolError extends TaggedError('IssueRunToolError')<{
  code:
    | 'connector_failed'
    | 'database_failed'
    | 'invalid_input'
    | 'invalid_state'
    | 'not_configured'
    | 'not_found'
  message: string
  cause?: unknown
  connectorError?: ConnectorError
}>() {}

export type IssueRunDb = ReturnType<typeof getIssueRunDb>

export function getIssueRunDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema })
}

export function dbError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new IssueRunToolError({
    code: 'database_failed',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

export function requireRunState(
  context: IssueRunToolContext,
): ResultValue<IssueRunToolState, IssueRunToolError> {
  const state = context.getRunState()
  return state
    ? Result.ok(state)
    : Result.err(
        new IssueRunToolError({
          code: 'invalid_state',
          message: 'Issue run tool called outside an active run.',
        }),
      )
}

export function toolErrorResult(error: IssueRunToolError) {
  return {
    ok: false as const,
    code: error.code,
    error: error.message,
    error_class: error.connectorError?.kind ?? null,
  }
}

export function toolOkResult<T extends Record<string, unknown>>(value: T) {
  return { ok: true as const, ...value }
}

export function connectorToolError(error: ConnectorError, message: string) {
  return new IssueRunToolError({
    code: 'connector_failed',
    message,
    connectorError: error,
    cause: error,
  })
}

export async function appendIssueRunEvent(args: {
  db: IssueRunDb
  run: IssueRunToolState
  eventType: IssueRunEventType
  stream?: IssueRunEventStream
  level?: IssueRunEventLevel
  message?: string | null
  payload?: Record<string, unknown> | null
}): Promise<ResultValue<void, IssueRunToolError>> {
  const result = await Result.tryPromise({
    try: async () => {
      await args.db.transaction(async (tx) => {
        await tx.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${args.run.runId}::text, 0))
        `)
        const [{ nextSeq }] = (await tx
          .select({
            nextSeq: sql<number>`cast(coalesce(max(${schema.issueRunEvent.seq}), 0) + 1 as int)`,
          })
          .from(schema.issueRunEvent)
          .where(eq(schema.issueRunEvent.runId, args.run.runId))) as [
          { nextSeq: number },
        ]
        await tx.insert(schema.issueRunEvent).values({
          id: crypto.randomUUID(),
          workspaceId: args.run.workspaceId,
          issueId: args.run.issueId,
          runId: args.run.runId,
          seq: nextSeq,
          eventType: args.eventType,
          stream: args.stream ?? 'system',
          level: args.level ?? 'info',
          message: args.message ?? null,
          payload: args.payload ?? null,
        })
      })
    },
    catch: (cause) => dbError('append issue run event', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok()
}

export async function updateRunStatus(args: {
  db: IssueRunDb
  run: IssueRunToolState
  status: IssueRunStatus
  error?: string | null
  resultJson?: Record<string, unknown> | null
  finished?: boolean
  completeWakeup?: boolean
}): Promise<ResultValue<void, IssueRunToolError>> {
  const now = new Date()
  const result = await Result.tryPromise({
    try: async () => {
      await args.db.transaction(async (tx) => {
        await tx
          .update(schema.issueRun)
          .set({
            status: args.status,
            ...(args.error !== undefined ? { error: args.error } : {}),
            ...(args.resultJson !== undefined
              ? { resultJson: args.resultJson }
              : {}),
            ...(args.finished ? { finishedAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(schema.issueRun.id, args.run.runId))

        if (args.finished) {
          await tx
            .update(schema.issue)
            .set({ activeRunId: null, updatedAt: now })
            .where(eq(schema.issue.id, args.run.issueId))
        }

        if (args.completeWakeup && args.run.wakeupId) {
          await tx
            .update(schema.issueWakeup)
            .set({
              status: 'completed',
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(schema.issueWakeup.id, args.run.wakeupId))
        }
      })
    },
    catch: (cause) => dbError('update issue run status', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok()
}

export function previousVersionsCount(payload: unknown) {
  const object = payload && typeof payload === 'object' ? payload : null
  const versions = (object as { previous_versions?: unknown } | null)
    ?.previous_versions
  return Array.isArray(versions) ? versions.length : 0
}
