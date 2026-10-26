import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getPooledDb } from '@garden/db/runtime'
import type { ConnectorError } from '@garden/core/connectors/errors'
import type {
  IssueRunEventLevel,
  IssueRunEventStream,
  IssueRunEventType,
  IssueRunStatus,
} from '@garden/core/types/issue-run'
import { LIVE_RUN_STATUSES } from '@garden/core/issues/run-sync'
import * as schema from '@garden/db/schema'
import type { GardenAnalyticsEventName } from '@garden/observability/analytics/events'
import { operationFailedMessage } from '../runtime-utils'

export type AgentDoRpcStub = {
  setName?: (name: string) => Promise<void>
  startIssueRunWorkflow: (input: {
    runId: string
    issueId: string
  }) => Promise<void>
  cancelIssueRun: (input: { runId: string; issueId: string }) => Promise<void>
}

export type AgentDoNamespace = {
  idFromName: (name: string) => DurableObjectId
  get: (id: DurableObjectId) => AgentDoRpcStub
}

export type IssueRunToolEnv = {
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  HYPERDRIVE: Hyperdrive
  FILES: R2Bucket
  AgentDO?: AgentDoNamespace
}

export type IssueRunToolState = {
  runId: string
  workspaceId: string
  issueId: string
  agentId: string
  agentOwnerUserId: string
  hostName: string
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
  captureAnalytics: (
    event: GardenAnalyticsEventName,
    properties: Record<string, unknown>,
  ) => void
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
    | 'storage_failed'
  message: string
  cause?: unknown
  connectorError?: ConnectorError
}>() {}

export type IssueRunDb = ReturnType<typeof getIssueRunDb>

/**
 * Resolves the issue-run Drizzle client from a Hyperdrive connection string.
 * Callers pass `env.HYPERDRIVE.connectionString`; pooling/closing is owned by
 * Hyperdrive + the memoized pool in `@garden/db/runtime`, so this no longer
 * opens a fresh direct-to-Neon serverless pool per tool invocation.
 */
export function getIssueRunDb(connectionString: string) {
  return getPooledDb(connectionString)
}

export function dbError(operation: string, cause: unknown) {
  return new IssueRunToolError({
    code: 'database_failed',
    message: operationFailedMessage(operation, cause),
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

/**
 * Applies an issue-run status update and clears ownership only for the run that
 * still owns the issue. Before this guard, a late completion could overwrite a
 * terminal run or clear a newer run's `activeRunId`. The live-status predicate
 * makes terminal writes single-winner; callers must skip terminal events when
 * the update returns `false`.
 */
export async function updateRunStatus(args: {
  db: IssueRunDb
  run: IssueRunToolState
  status: IssueRunStatus
  error?: string | null
  resultJson?: Record<string, unknown> | null
  finished?: boolean
}): Promise<ResultValue<boolean, IssueRunToolError>> {
  const now = new Date()
  const result = await Result.tryPromise({
    try: async () => {
      return await args.db.transaction(async (tx) => {
        const [updatedRun] = await tx
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
          .where(
            args.finished
              ? and(
                  eq(schema.issueRun.id, args.run.runId),
                  inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
                )
              : eq(schema.issueRun.id, args.run.runId),
          )
          .returning({ id: schema.issueRun.id })

        if (!args.finished || !updatedRun) return Boolean(updatedRun)

        await tx
          .update(schema.issue)
          .set({ activeRunId: null, updatedAt: now })
          .where(
            and(
              eq(schema.issue.id, args.run.issueId),
              eq(schema.issue.activeRunId, args.run.runId),
            ),
          )
        return true
      })
    },
    catch: (cause) => dbError('update issue run status', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value)
}

export function previousVersionsCount(payload: unknown) {
  const object = payload && typeof payload === 'object' ? payload : null
  const versions = (object as { previous_versions?: unknown } | null)
    ?.previous_versions
  return Array.isArray(versions) ? versions.length : 0
}
