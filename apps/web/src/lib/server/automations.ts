import { and, desc, eq, sql } from 'drizzle-orm'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { CronExpressionParser } from 'cron-parser'
import {
  cancelAutomationRun,
  startAutomationRun,
} from '@garden/server/automations/run-service'
import { getDb, schema } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'

type AutomationRow = typeof schema.automation.$inferSelect
type AutomationTriggerRow = typeof schema.automationTrigger.$inferSelect
type AutomationRunRow = typeof schema.automationRun.$inferSelect

type AutomationConcurrencyPolicy = 'skip' | 'replace'
type AutomationRunSource = 'manual' | 'api'

type DispatchAutomationInput = {
  env: AppEnv
  automation: AutomationRow
  source: AutomationRunSource
  actorId: string
  payload?: unknown
}

type InstallScheduleInput = {
  env: AppEnv
  trigger: AutomationTriggerRow
  automation: Pick<AutomationRow, 'id' | 'status' | 'concurrencyPolicy'>
  nextRunAt?: Date
}

type ActiveAutomationRun = {
  automation_run_id: string
  workspace_id: string
  status: string
}

const LIVE_AUTOMATION_RUN_STATUSES = ['queued', 'running'] as const

export class AutomationApiError extends TaggedError('AutomationApiError')<{
  code:
    | 'agent_not_found'
    | 'automation_not_found'
    | 'cron_error'
    | 'db_error'
    | 'dispatch_failed'
    | 'invalid_config'
    | 'runtime_error'
    | 'unsupported_policy'
  message: string
  cause?: unknown
}>() {}

function automationError(args: {
  code: AutomationApiError['code']
  message: string
  cause?: unknown
}) {
  return new AutomationApiError(args)
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function objectOrNull(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function dbError(operation: string, cause: unknown) {
  return automationError({
    code: 'db_error',
    message: `${operation} failed: ${errorMessage(cause)}`,
    cause,
  })
}

function runtimeError(operation: string, cause: unknown) {
  return automationError({
    code: 'runtime_error',
    message: `${operation} failed: ${errorMessage(cause)}`,
    cause,
  })
}

function dateToIso(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : null
}

function parseConcurrencyPolicy(
  value: string,
): ResultValue<AutomationConcurrencyPolicy, AutomationApiError> {
  if (value === 'skip' || value === 'replace') return Result.ok(value)
  if (value === 'queue') {
    return Result.err(
      automationError({
        code: 'unsupported_policy',
        message: 'Automation queue concurrency policy is not implemented.',
      }),
    )
  }
  return Result.err(
    automationError({
      code: 'invalid_config',
      message: `Invalid automation concurrency policy "${value}".`,
    }),
  )
}

export function nextRunFromCron(args: {
  cronExpression: string
  timezone: string
  from: Date
}): ResultValue<Date, AutomationApiError> {
  return Result.try({
    try: () =>
      CronExpressionParser.parse(args.cronExpression, {
        currentDate: args.from,
        tz: args.timezone,
      })
        .next()
        .toDate(),
    catch: (cause) =>
      automationError({
        code: 'cron_error',
        message: `Invalid automation cron "${args.cronExpression}" for timezone "${args.timezone}": ${errorMessage(cause)}`,
        cause,
      }),
  })
}

function hydrateDoResult<T>(
  value: unknown,
): ResultValue<T, AutomationApiError> {
  const result = Result.deserialize<T, { message?: string; code?: string }>(
    value,
  )
  if (result.isErr()) {
    return Result.err(
      runtimeError('deserialize automation trigger result', result.error),
    )
  }
  return Result.ok(result.value)
}

function triggerStub(env: AppEnv, triggerId: string) {
  return env.AUTOMATION_TRIGGER.get(
    env.AUTOMATION_TRIGGER.idFromName(triggerId),
  )
}

export function toAutomation(row: AutomationRow) {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    title: row.title,
    description: row.description,
    assignee_agent_id: row.assigneeAgentId,
    priority: row.priority,
    status: row.status,
    concurrency_policy: row.concurrencyPolicy,
    last_run_at: dateToIso(row.lastRunAt),
    created_by: row.createdBy,
    created_at: dateToIso(row.createdAt),
    updated_at: dateToIso(row.updatedAt),

    system_prompt: row.systemPrompt,
    input_schema: row.inputSchema,
    context_sources: row.contextSources,
    output_config: row.outputConfig,
    execution_config: row.executionConfig,
    notification_config: row.notificationConfig,
    scheduling_config: row.schedulingConfig,
    tags: row.tags,
    category: row.category,
    template_source: row.templateSource,
    next_run_at: dateToIso(row.nextRunAt),
    run_count: row.runCount,
    success_count: row.successCount,
    failure_count: row.failureCount,
    skip_count: row.skipCount,
    avg_duration_ms: row.avgDurationMs,
    updated_by: row.updatedBy,
    metadata: row.metadata,
  }
}

export function toAutomationListItem(
  row: Pick<
    AutomationRow,
    'id' | 'title' | 'assigneeAgentId' | 'status' | 'lastRunAt'
  > & { assigneeAgentName: string | null },
) {
  return {
    id: row.id,
    title: row.title,
    assignee_agent_id: row.assigneeAgentId,
    assignee_agent_name: row.assigneeAgentName,
    status: row.status,
    last_run_at: dateToIso(row.lastRunAt),
  }
}

export function toAutomationTrigger(row: AutomationTriggerRow) {
  return {
    id: row.id,
    automation_id: row.automationId,
    kind: row.kind,
    enabled: row.enabled,
    label: row.label,
    cron_expression: row.cronExpression,
    timezone: row.timezone,
    next_run_at: null,
    last_fired_at: null,
    created_at: dateToIso(row.createdAt),
    updated_at: dateToIso(row.updatedAt),
  }
}

export function toAutomationRun(
  row: AutomationRunRow,
  options: { debug?: boolean } = {},
) {
  const resultJson = objectOrNull(row.resultJson)
  const run = {
    id: row.id,
    automation_id: row.automationId,
    trigger_id: row.triggerId,
    source: row.source,
    status: row.status,
    run_id: row.workflowInstanceId ?? row.id,
    triggered_at: dateToIso(row.triggeredAt),
    completed_at: dateToIso(row.completedAt),
    failure_reason: row.failureReason,
    trigger_payload: row.triggerPayload,
    created_at: dateToIso(row.createdAt),
    result_json: resultJson,
  }

  if (!options.debug) return run

  return {
    ...run,
    usage_json: objectOrNull(row.usageJson),
  }
}

export function automationOk(value: unknown, status = 200) {
  return Response.json({ ok: true, value }, { status })
}

export function automationErr(
  error: AutomationApiError | string,
  status = 400,
) {
  const message = typeof error === 'string' ? error : error.message
  const code = typeof error === 'string' ? 'bad_request' : error.code
  return Response.json({ ok: false, error: { code, message } }, { status })
}

export async function requireAutomation(
  env: AppEnv,
  automationId: string,
): Promise<ResultValue<AutomationRow | null, AutomationApiError>> {
  const db = await getDb(env)
  const result = await Result.tryPromise({
    try: async () => {
      const [row] = await db
        .select()
        .from(schema.automation)
        .where(eq(schema.automation.id, automationId))
        .limit(1)
      return row ?? null
    },
    catch: (cause) => dbError('load automation', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value)
}

export async function ensureAgentInWorkspace(args: {
  env: AppEnv
  workspaceId: string
  agentId: string
}): Promise<ResultValue<void, AutomationApiError>> {
  const db = await getDb(args.env)
  const result = await Result.tryPromise({
    try: async () => {
      const [agent] = await db
        .select({ id: schema.agent.id })
        .from(schema.agent)
        .where(
          and(
            eq(schema.agent.id, args.agentId),
            eq(schema.agent.workspaceId, args.workspaceId),
            sql`${schema.agent.status} <> 'archived'`,
          ),
        )
        .limit(1)
      return agent ?? null
    },
    catch: (cause) => dbError('load automation agent', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  if (!result.value) {
    return Result.err(
      automationError({
        code: 'agent_not_found',
        message: 'Agent not found.',
      }),
    )
  }
  return Result.ok()
}

export async function installScheduleTrigger({
  env,
  trigger,
  automation,
  nextRunAt,
}: InstallScheduleInput): Promise<
  ResultValue<Date | null, AutomationApiError>
> {
  if (trigger.kind !== 'schedule' || !trigger.enabled) {
    const uninstallResult = await uninstallScheduleTrigger(env, trigger.id)
    if (uninstallResult.isErr()) return Result.err(uninstallResult.error)
    return Result.ok(null)
  }
  if (automation.status !== 'active') {
    const uninstallResult = await uninstallScheduleTrigger(env, trigger.id)
    if (uninstallResult.isErr()) return Result.err(uninstallResult.error)
    return Result.ok(null)
  }
  if (!trigger.cronExpression || !trigger.timezone) {
    return Result.err(
      automationError({
        code: 'invalid_config',
        message: 'Schedule trigger is missing cron expression or timezone.',
      }),
    )
  }

  const policyResult = parseConcurrencyPolicy(automation.concurrencyPolicy)
  if (policyResult.isErr()) return Result.err(policyResult.error)

  const nextRunAtResult = nextRunAt
    ? Result.ok(nextRunAt)
    : nextRunFromCron({
        cronExpression: trigger.cronExpression,
        timezone: trigger.timezone,
        from: new Date(),
      })
  if (nextRunAtResult.isErr()) return Result.err(nextRunAtResult.error)

  const rawResult = await Result.tryPromise({
    try: async () =>
      (await triggerStub(env, trigger.id).install({
        triggerId: trigger.id,
        automationId: automation.id,
        concurrencyPolicy: policyResult.value,
        nextRunAt: nextRunAtResult.value,
      })) as unknown,
    catch: (cause) => runtimeError('install automation trigger', cause),
  })
  if (rawResult.isErr()) return Result.err(rawResult.error)

  const installResult = hydrateDoResult<void>(rawResult.value)
  if (installResult.isErr()) return Result.err(installResult.error)
  return Result.ok(nextRunAtResult.value)
}

export async function uninstallScheduleTrigger(
  env: AppEnv,
  triggerId: string,
): Promise<ResultValue<void, AutomationApiError>> {
  const rawResult = await Result.tryPromise({
    try: async () => (await triggerStub(env, triggerId).uninstall()) as unknown,
    catch: (cause) => runtimeError('uninstall automation trigger', cause),
  })
  if (rawResult.isErr()) return Result.err(rawResult.error)

  const uninstallResult = hydrateDoResult<void>(rawResult.value)
  if (uninstallResult.isErr()) return Result.err(uninstallResult.error)
  return Result.ok()
}

export async function uninstallAutomationSchedules(
  env: AppEnv,
  automationId: string,
): Promise<ResultValue<void, AutomationApiError>> {
  const db = await getDb(env)
  const rowsResult = await Result.tryPromise({
    try: async () =>
      await db
        .select({ id: schema.automationTrigger.id })
        .from(schema.automationTrigger)
        .where(
          and(
            eq(schema.automationTrigger.automationId, automationId),
            eq(schema.automationTrigger.kind, 'schedule'),
          ),
        ),
    catch: (cause) => dbError('load automation schedules', cause),
  })
  if (rowsResult.isErr()) return Result.err(rowsResult.error)

  for (const row of rowsResult.value) {
    const uninstallResult = await uninstallScheduleTrigger(env, row.id)
    if (uninstallResult.isErr()) return Result.err(uninstallResult.error)
  }
  const clearResult = await Result.tryPromise({
    try: async () => {
      await db
        .update(schema.automationTrigger)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(schema.automationTrigger.automationId, automationId),
            eq(schema.automationTrigger.kind, 'schedule'),
          ),
        )
    },
    catch: (cause) => dbError('clear automation schedule alarms', cause),
  })
  if (clearResult.isErr()) return Result.err(clearResult.error)
  return Result.ok()
}

export async function syncAutomationSchedules(
  env: AppEnv,
  automation: Pick<AutomationRow, 'id' | 'status' | 'concurrencyPolicy'>,
): Promise<ResultValue<void, AutomationApiError>> {
  const db = await getDb(env)
  const rowsResult = await Result.tryPromise({
    try: async () =>
      await db
        .select()
        .from(schema.automationTrigger)
        .where(
          and(
            eq(schema.automationTrigger.automationId, automation.id),
            eq(schema.automationTrigger.kind, 'schedule'),
          ),
        ),
    catch: (cause) => dbError('load automation schedules', cause),
  })
  if (rowsResult.isErr()) return Result.err(rowsResult.error)

  for (const trigger of rowsResult.value) {
    const installResult = await installScheduleTrigger({
      env,
      trigger,
      automation,
    })
    if (installResult.isErr()) return Result.err(installResult.error)
    if (installResult.value) {
      const updateResult = await Result.tryPromise({
        try: async () => {
          await db
            .update(schema.automationTrigger)
            .set({ updatedAt: new Date() })
            .where(eq(schema.automationTrigger.id, trigger.id))
        },
        catch: (cause) => dbError('touch automation trigger', cause),
      })
      if (updateResult.isErr()) return Result.err(updateResult.error)
    }
  }
  return Result.ok()
}

async function loadActiveAutomationRun(args: {
  env: AppEnv
  automationId: string
}): Promise<ResultValue<ActiveAutomationRun | null, AutomationApiError>> {
  const db = await getDb(args.env)
  const result = await Result.tryPromise({
    try: async () => {
      const rows = await db.execute<ActiveAutomationRun>(sql`
        select
          ar.id as automation_run_id,
          ar.workspace_id,
          ar.status
        from automation_run ar
        where ar.automation_id = ${args.automationId}
          and ar.status in (${sql.join(
            LIVE_AUTOMATION_RUN_STATUSES.map((status) => sql`${status}`),
            sql`, `,
          )})
        order by ar.triggered_at desc
        limit 1
      `)
      return rows.rows[0] ?? null
    },
    catch: (cause) => dbError('load active automation run', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value)
}

async function applyDispatchConcurrency(args: {
  env: AppEnv
  automation: AutomationRow
  source: AutomationRunSource
  payload?: unknown
  actorId: string
}): Promise<ResultValue<'fire' | AutomationRunRow, AutomationApiError>> {
  const policyResult = parseConcurrencyPolicy(args.automation.concurrencyPolicy)
  if (policyResult.isErr()) return Result.err(policyResult.error)

  const activeResult = await loadActiveAutomationRun({
    env: args.env,
    automationId: args.automation.id,
  })
  if (activeResult.isErr()) return Result.err(activeResult.error)
  const active = activeResult.value
  if (!active) return Result.ok('fire')

  const db = await getDb(args.env)
  const now = new Date()
  if (policyResult.value === 'skip') {
    const insertResult = await Result.tryPromise({
      try: async () => {
        const [run] = await db
          .insert(schema.automationRun)
          .values({
            id: crypto.randomUUID(),
            workspaceId: args.automation.workspaceId,
            automationId: args.automation.id,
            source: args.source,
            status: 'skipped',
            agentId: args.automation.assigneeAgentId,
            hostName: args.automation.assigneeAgentId,
            triggeredAt: now,
            completedAt: now,
            failureReason: 'concurrency_policy_skip',
            triggerPayload: args.payload ?? null,
            updatedAt: now,
          })
          .returning()
        await db
          .update(schema.automation)
          .set({
            lastRunAt: now,
            updatedAt: now,
            runCount: sql`${schema.automation.runCount} + 1`,
            skipCount: sql`${schema.automation.skipCount} + 1`,
          })
          .where(eq(schema.automation.id, args.automation.id))
        return run
      },
      catch: (cause) => dbError('record skipped automation run', cause),
    })
    if (insertResult.isErr()) return Result.err(insertResult.error)
    return Result.ok(insertResult.value)
  }

  const cancelResult = await cancelAutomationRun(args.env, {
    workspaceId: active.workspace_id,
    runId: active.automation_run_id,
    actor: { type: 'member', id: args.actorId },
    reason: 'automation_replace',
  })
  if (cancelResult.isErr()) {
    return Result.err(
      automationError({
        code: 'dispatch_failed',
        message: cancelResult.error.message,
        cause: cancelResult.error,
      }),
    )
  }

  const markResult = await Result.tryPromise({
    try: async () => {
      await db
        .update(schema.automationRun)
        .set({
          status: 'cancelled',
          completedAt: now,
          failureReason: 'replaced_by_automation',
          error: 'replaced_by_automation',
          updatedAt: now,
        })
        .where(eq(schema.automationRun.id, active.automation_run_id))
    },
    catch: (cause) => dbError('mark replaced automation run', cause),
  })
  if (markResult.isErr()) return Result.err(markResult.error)
  return Result.ok('fire')
}

export async function dispatchAutomation(
  input: DispatchAutomationInput,
): Promise<ResultValue<AutomationRunRow, AutomationApiError>> {
  if (input.automation.status !== 'active') {
    return Result.err(
      automationError({
        code: 'invalid_config',
        message: 'Automation is not active.',
      }),
    )
  }

  const concurrencyResult = await applyDispatchConcurrency(input)
  if (concurrencyResult.isErr()) return Result.err(concurrencyResult.error)
  if (concurrencyResult.value !== 'fire')
    return Result.ok(concurrencyResult.value)

  const db = await getDb(input.env)
  const now = new Date()
  const runId = crypto.randomUUID()
  const startResult = await startAutomationRun(input.env, {
    workspaceId: input.automation.workspaceId,
    automationId: input.automation.id,
    source: input.source,
    runId,
    agentId: input.automation.assigneeAgentId,
    trigger: { correlationId: `automation:${runId}:${input.source}` },
    actor: { type: 'member', id: input.actorId },
    payload: input.payload ?? null,
    contextSnapshot: {
      automation: {
        id: input.automation.id,
        title: input.automation.title,
        description: input.automation.description,
        system_prompt: input.automation.systemPrompt,
        input_schema: input.automation.inputSchema,
        context_sources: input.automation.contextSources,
        output_config: input.automation.outputConfig,
        execution_config: input.automation.executionConfig,
        tags: input.automation.tags,
        category: input.automation.category,
      },
    },
  })
  if (startResult.isErr()) {
    const failedResult = await markAutomationRunFailed({
      env: input.env,
      runId,
      message: startResult.error.message,
    })
    if (failedResult.isErr()) return Result.err(failedResult.error)
    return Result.err(
      automationError({
        code: 'dispatch_failed',
        message: startResult.error.message,
        cause: startResult.error,
      }),
    )
  }

  const updateResult = await Result.tryPromise({
    try: async () => {
      await db
        .update(schema.automation)
        .set({ lastRunAt: now, updatedAt: now })
        .where(eq(schema.automation.id, input.automation.id))
      const [run] = await db
        .select()
        .from(schema.automationRun)
        .where(eq(schema.automationRun.id, runId))
      return run
    },
    catch: (cause) => dbError('mark automation last run', cause),
  })
  if (updateResult.isErr()) return Result.err(updateResult.error)
  if (!updateResult.value) {
    return Result.err(
      automationError({
        code: 'dispatch_failed',
        message: 'Automation run was not persisted.',
      }),
    )
  }
  return Result.ok(updateResult.value)
}

async function markAutomationRunFailed(args: {
  env: AppEnv
  runId: string
  message: string
}): Promise<ResultValue<void, AutomationApiError>> {
  const db = await getDb(args.env)
  const now = new Date()
  const result = await Result.tryPromise({
    try: async () => {
      await db
        .update(schema.automationRun)
        .set({
          status: 'failed',
          completedAt: now,
          failureReason: args.message,
          error: args.message,
          updatedAt: now,
        })
        .where(eq(schema.automationRun.id, args.runId))
    },
    catch: (cause) => dbError('mark automation run failed', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok()
}

export async function listAutomationRuns(args: {
  env: AppEnv
  automationId: string
  source?: string
  limit?: number
  offset?: number
}): Promise<ResultValue<AutomationRunRow[], AutomationApiError>> {
  const db = await getDb(args.env)
  const conditions = [eq(schema.automationRun.automationId, args.automationId)]
  if (args.source) conditions.push(eq(schema.automationRun.source, args.source))
  const result = await Result.tryPromise({
    try: async () =>
      await db
        .select()
        .from(schema.automationRun)
        .where(and(...conditions))
        .orderBy(desc(schema.automationRun.triggeredAt))
        .limit(args.limit ?? 50)
        .offset(args.offset ?? 0),
    catch: (cause) => dbError('list automation runs', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value)
}

export async function listAutomationTriggers(args: {
  env: AppEnv
  automationId: string
}): Promise<ResultValue<AutomationTriggerRow[], AutomationApiError>> {
  const db = await getDb(args.env)
  const result = await Result.tryPromise({
    try: async () =>
      await db
        .select()
        .from(schema.automationTrigger)
        .where(eq(schema.automationTrigger.automationId, args.automationId))
        .orderBy(desc(schema.automationTrigger.createdAt)),
    catch: (cause) => dbError('list automation triggers', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value)
}
