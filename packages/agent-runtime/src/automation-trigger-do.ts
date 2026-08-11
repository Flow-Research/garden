import { Agent } from 'agents'
import { eq, sql } from 'drizzle-orm'
import { getPooledDb } from '@garden/db/runtime'
import {
  Result,
  TaggedError,
  type Result as ResultValue,
  type SerializedResult,
} from 'better-result'
import { CronExpressionParser } from 'cron-parser'
import * as schema from '@garden/db/schema'
import { createGardenLogger } from '@garden/observability/logger'
import {
  cancelAutomationRun,
  startAutomationRun,
  type AutomationRunEnv,
} from '@garden/server/automations/run-service'

type AutomationTriggerEnv = Cloudflare.Env & AutomationRunEnv
type AutomationConcurrencyPolicy = 'skip' | 'replace'
type AutomationRunSource = 'schedule' | 'manual' | 'webhook' | 'api'
const LIVE_AUTOMATION_RUN_STATUSES = ['queued', 'running'] as const
const automationTriggerLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'automation-trigger-do',
})

type AutomationConfig = {
  triggerId: string
  automationId: string
  concurrencyPolicy: AutomationConcurrencyPolicy
  scheduleId: string | null
}

type AutomationState = {
  inFlightRunId: string | null
}

type AutomationRow = {
  id: string
  workspaceId: string
  projectId: string | null
  title: string
  description: string | null
  systemPrompt: string | null
  inputSchema: unknown
  contextSources: unknown
  outputConfig: unknown
  executionConfig: unknown
  tags: string[]
  category: string | null
  assigneeAgentId: string
  priority: string
  status: string
  concurrencyPolicy: string
  createdBy: string
  agentHostName: string | null
}

type TriggerScheduleRow = {
  triggerId: string
  automationId: string
  enabled: boolean
  kind: string
  cronExpression: string | null
  timezone: string | null
  automationStatus: string
  concurrencyPolicy: string
}

type InFlightRunRow = {
  id: string
  workspaceId: string
  status: string
}

const CONFIG_KEY = 'config'
const STATE_KEY = 'state'

export class AutomationDoError extends TaggedError('AutomationDoError')<{
  code:
    | 'cron_error'
    | 'db_error'
    | 'dispatch_failed'
    | 'invalid_config'
    | 'run_not_found'
    | 'schedule_error'
    | 'unsupported_policy'
  message: string
  cause?: unknown
}>() {}

function automationDoError(args: {
  code: AutomationDoError['code']
  message: string
  cause?: unknown
}) {
  return new AutomationDoError(args)
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function dbError(operation: string, cause: unknown) {
  return automationDoError({
    code: 'db_error',
    message: `${operation} failed: ${errorMessage(cause)}`,
    cause,
  })
}

function dispatchError(operation: string, cause: unknown) {
  return automationDoError({
    code: 'dispatch_failed',
    message: `${operation} failed: ${errorMessage(cause)}`,
    cause,
  })
}

function scheduleError(operation: string, cause: unknown) {
  return automationDoError({
    code: 'schedule_error',
    message: `${operation} failed: ${errorMessage(cause)}`,
    cause,
  })
}

function coerceDate(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function parseConcurrencyPolicy(
  value: string,
): ResultValue<AutomationConcurrencyPolicy, AutomationDoError> {
  if (value === 'skip' || value === 'replace') return Result.ok(value)
  if (value === 'queue') {
    return Result.err(
      automationDoError({
        code: 'unsupported_policy',
        message: 'Automation queue concurrency policy is not implemented.',
      }),
    )
  }
  return Result.err(
    automationDoError({
      code: 'invalid_config',
      message: `Invalid automation concurrency policy "${value}".`,
    }),
  )
}

function nextRunFromCron(args: {
  cronExpression: string
  timezone: string
  from: Date
}): ResultValue<Date, AutomationDoError> {
  return Result.try({
    try: () =>
      CronExpressionParser.parse(args.cronExpression, {
        currentDate: args.from,
        tz: args.timezone,
      })
        .next()
        .toDate(),
    catch: (cause) =>
      automationDoError({
        code: 'cron_error',
        message: `Invalid automation cron "${args.cronExpression}" for timezone "${args.timezone}": ${errorMessage(cause)}`,
        cause,
      }),
  })
}

function emptyState(): AutomationState {
  return { inFlightRunId: null }
}

export class AutomationTriggerDO extends Agent<AutomationTriggerEnv> {
  /**
   * Resolves the automation-trigger Drizzle client through Hyperdrive's pooled
   * connection string. Previously called `drizzle(this.env.DATABASE_URL)` from
   * the neon-serverless driver, opening a fresh direct-to-Neon WebSocket pool
   * per call that bypassed Hyperdrive, never closed, and defeated Neon
   * autosuspend. `getPooledDb` now uses one short-idle socket per
   * invocation-local adapter so no pool survives into another request.
   */
  private db() {
    return getPooledDb(this.env.HYPERDRIVE.connectionString)
  }

  async install(args: {
    triggerId: string
    automationId: string
    concurrencyPolicy: AutomationConcurrencyPolicy
    nextRunAt: Date | string | number
  }): Promise<SerializedResult<void, AutomationDoError>> {
    const result = await this.installTrigger(args)
    return Result.serialize(result)
  }

  private async installTrigger(args: {
    triggerId: string
    automationId: string
    concurrencyPolicy: AutomationConcurrencyPolicy
    nextRunAt: Date | string | number
  }): Promise<ResultValue<void, AutomationDoError>> {
    const nextRunAt = coerceDate(args.nextRunAt)
    if (!nextRunAt) {
      return Result.err(
        automationDoError({
          code: 'invalid_config',
          message: 'Automation trigger nextRunAt is invalid.',
        }),
      )
    }

    const policyResult = parseConcurrencyPolicy(args.concurrencyPolicy)
    if (policyResult.isErr()) return Result.err(policyResult.error)

    const existingConfig = this.getConfig()
    const scheduledResult = await this.scheduleAutomationTrigger(
      {
        triggerId: args.triggerId,
        automationId: args.automationId,
        concurrencyPolicy: policyResult.value,
        scheduleId: existingConfig?.scheduleId ?? null,
      },
      nextRunAt,
    )
    if (scheduledResult.isErr()) return Result.err(scheduledResult.error)

    this.ctx.storage.kv.put(CONFIG_KEY, scheduledResult.value)
    this.ctx.storage.kv.put(STATE_KEY, this.getRunState())

    return Result.ok()
  }

  async uninstall(): Promise<SerializedResult<void, AutomationDoError>> {
    const result = await this.uninstallTrigger()
    return Result.serialize(result)
  }

  private async uninstallTrigger(): Promise<
    ResultValue<void, AutomationDoError>
  > {
    const config = this.getConfig()
    const cancelResult = await this.cancelAutomationSchedule(config)
    if (cancelResult.isErr()) return Result.err(cancelResult.error)

    this.ctx.storage.kv.delete(CONFIG_KEY)
    this.ctx.storage.kv.delete(STATE_KEY)

    return Result.ok()
  }

  async describe(): Promise<{
    nextRunAt: Date | null
    inFlightRunId: string | null
  }> {
    const config = this.getConfig()
    const schedule = config?.scheduleId
      ? await this.getScheduleById(config.scheduleId)
      : undefined
    return {
      nextRunAt: schedule?.time ? new Date(schedule.time) : null,
      inFlightRunId: this.getRunState().inFlightRunId,
    }
  }

  async fireNow(args: {
    source: Exclude<AutomationRunSource, 'schedule'>
    payload?: unknown
  }): Promise<SerializedResult<{ runId: string }, AutomationDoError>> {
    const result = await this.fireNowTrigger(args)
    return Result.serialize(result)
  }

  private async fireNowTrigger(args: {
    source: Exclude<AutomationRunSource, 'schedule'>
    payload?: unknown
  }): Promise<ResultValue<{ runId: string }, AutomationDoError>> {
    const config = this.getConfig()
    if (!config) {
      return Result.err(
        automationDoError({
          code: 'invalid_config',
          message: 'Automation trigger is not installed.',
        }),
      )
    }

    return await this.dispatch({
      config,
      source: args.source,
      payload: args.payload,
    })
  }

  /**
   * Invoked by the Agents SDK schedule row created for the trigger. Garden
   * still computes timezone-aware next run dates itself, but Cloudflare now
   * owns alarm dispatch, retries, and schedule bookkeeping instead of our DO
   * writing raw alarms directly.
   */
  async fireScheduledTrigger(payload: AutomationConfig): Promise<void> {
    const result = await Result.tryPromise({
      try: async () => await this.handleScheduledTrigger(payload),
      catch: (cause) =>
        automationDoError({
          code: 'dispatch_failed',
          message: `Automation trigger schedule failed: ${errorMessage(cause)}`,
          cause,
        }),
    })
    if (result.isErr()) {
      console.error('[agent-runtime] automation trigger schedule failed', {
        message: result.error.message,
        code: result.error.code,
      })
    }
  }

  private async handleScheduledTrigger(
    payload: AutomationConfig,
  ): Promise<ResultValue<void, AutomationDoError>> {
    const config = this.getConfig()
    if (!config || config.triggerId !== payload.triggerId) return Result.ok()

    const policyResult = await this.applyConcurrencyPolicy(config)
    if (policyResult.isErr()) return Result.err(policyResult.error)

    if (policyResult.value === 'skip') {
      const skippedResult = await this.recordSkippedRun(config)
      if (skippedResult.isErr()) return Result.err(skippedResult.error)
      const nextResult = await this.scheduleNext(config.triggerId, new Date())
      if (nextResult.isErr()) return Result.err(nextResult.error)
      return Result.ok()
    }

    const dispatchResult = await this.dispatch({ config, source: 'schedule' })
    if (dispatchResult.isErr()) {
      console.error('[agent-runtime] automation dispatch failed', {
        automationId: config.automationId,
        triggerId: config.triggerId,
        message: dispatchResult.error.message,
      })
    }

    const nextResult = await this.scheduleNext(config.triggerId, new Date())
    if (nextResult.isErr()) return Result.err(nextResult.error)

    return dispatchResult.isOk()
      ? Result.ok()
      : Result.err(dispatchResult.error)
  }

  private getConfig() {
    const config = this.ctx.storage.kv.get<AutomationConfig>(CONFIG_KEY) ?? null
    if (!config) return null
    return {
      ...config,
      scheduleId: config.scheduleId ?? null,
    }
  }

  private getRunState(): AutomationState {
    return this.ctx.storage.kv.get<AutomationState>(STATE_KEY) ?? emptyState()
  }

  private setRunState(state: AutomationState) {
    this.ctx.storage.kv.put(STATE_KEY, state)
  }

  private clearInFlightState() {
    this.setRunState(emptyState())
  }

  private async applyConcurrencyPolicy(
    config: AutomationConfig,
  ): Promise<ResultValue<'fire' | 'skip', AutomationDoError>> {
    const state = this.getRunState()
    if (!state.inFlightRunId) return Result.ok('fire')

    const runResult = await this.loadInFlightRun(state.inFlightRunId)
    if (runResult.isErr()) return Result.err(runResult.error)
    const run = runResult.value
    if (!run) {
      this.clearInFlightState()
      return Result.ok('fire')
    }

    if (
      !(LIVE_AUTOMATION_RUN_STATUSES as readonly string[]).includes(run.status)
    ) {
      this.clearInFlightState()
      return Result.ok('fire')
    }

    if (config.concurrencyPolicy === 'skip') return Result.ok('skip')

    const cancelResult = await cancelAutomationRun(this.env, {
      workspaceId: run.workspaceId,
      runId: run.id,
      actor: { type: 'system', id: 'automation' },
      reason: 'automation_replace',
    })
    if (cancelResult.isErr()) {
      return Result.err(
        dispatchError('cancel replaced automation run', cancelResult.error),
      )
    }

    const updateResult = await this.markAutomationRunReplaced(state)
    if (updateResult.isErr()) return Result.err(updateResult.error)

    this.clearInFlightState()
    return Result.ok('fire')
  }

  private async loadInFlightRun(
    runId: string,
  ): Promise<ResultValue<InFlightRunRow | null, AutomationDoError>> {
    const db = this.db()
    const result = await Result.tryPromise({
      try: async () => {
        const [run] = await db
          .select({
            id: schema.automationRun.id,
            workspaceId: schema.automationRun.workspaceId,
            status: schema.automationRun.status,
          })
          .from(schema.automationRun)
          .where(eq(schema.automationRun.id, runId))
          .limit(1)
        return run ?? null
      },
      catch: (cause) => dbError('load in-flight automation run', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok(result.value)
  }

  private async markAutomationRunReplaced(
    state: AutomationState,
  ): Promise<ResultValue<void, AutomationDoError>> {
    if (!state.inFlightRunId) return Result.ok()

    const db = this.db()
    const now = new Date()
    const result = await Result.tryPromise({
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
          .where(eq(schema.automationRun.id, state.inFlightRunId!))
      },
      catch: (cause) => dbError('mark replaced automation run', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    return Result.ok()
  }

  /**
   * Creates the next one-time SDK schedule for a timezone-aware cron trigger.
   * Agents SDK cron schedules do not expose timezone control, so Garden keeps
   * cron-parser as the calendar engine and delegates only the durable wakeup.
   */
  private async scheduleAutomationTrigger(
    config: AutomationConfig,
    nextRunAt: Date,
  ): Promise<ResultValue<AutomationConfig, AutomationDoError>> {
    const cancelResult = await this.cancelAutomationSchedule(config)
    if (cancelResult.isErr()) return Result.err(cancelResult.error)

    const result = await Result.tryPromise({
      try: async () =>
        await this.schedule(nextRunAt, 'fireScheduledTrigger', {
          ...config,
          scheduleId: null,
        } satisfies AutomationConfig),
      catch: (cause) => scheduleError('schedule automation trigger', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    return Result.ok({ ...config, scheduleId: result.value.id })
  }

  private async cancelAutomationSchedule(
    config: AutomationConfig | null,
  ): Promise<ResultValue<void, AutomationDoError>> {
    if (!config?.scheduleId) return Result.ok()

    const result = await Result.tryPromise({
      try: async () => await this.cancelSchedule(config.scheduleId!),
      catch: (cause) =>
        scheduleError('cancel automation trigger schedule', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    return Result.ok()
  }

  private async recordSkippedRun(
    config: AutomationConfig,
  ): Promise<ResultValue<{ runId: string }, AutomationDoError>> {
    const automationResult = await this.loadAutomation(config.automationId)
    if (automationResult.isErr()) return Result.err(automationResult.error)
    const automation = automationResult.value
    if (!automation) {
      return Result.err(
        automationDoError({
          code: 'invalid_config',
          message: 'Automation not found.',
        }),
      )
    }

    const db = this.db()
    const runId = crypto.randomUUID()
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () => {
        await db.insert(schema.automationRun).values({
          id: runId,
          workspaceId: automation.workspaceId,
          automationId: config.automationId,
          triggerId: config.triggerId,
          source: 'schedule',
          status: 'skipped',
          agentId: automation.assigneeAgentId,
          hostName: automation.agentHostName ?? automation.assigneeAgentId,
          triggeredAt: now,
          completedAt: now,
          failureReason: 'concurrency_policy_skip',
          updatedAt: now,
        })
        await db
          .update(schema.automation)
          .set({
            lastRunAt: now,
            updatedAt: now,
            runCount: sql`${schema.automation.runCount} + 1`,
            skipCount: sql`${schema.automation.skipCount} + 1`,
          })
          .where(eq(schema.automation.id, config.automationId))
      },
      catch: (cause) => dbError('record skipped automation run', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    return Result.ok({ runId })
  }

  private async dispatch(args: {
    config: AutomationConfig
    source: AutomationRunSource
    payload?: unknown
  }): Promise<ResultValue<{ runId: string }, AutomationDoError>> {
    const automationResult = await this.loadAutomation(args.config.automationId)
    if (automationResult.isErr()) return Result.err(automationResult.error)

    const automation = automationResult.value
    if (!automation) {
      return Result.err(
        automationDoError({
          code: 'invalid_config',
          message: 'Automation not found.',
        }),
      )
    }
    if (automation.status !== 'active') {
      return Result.err(
        automationDoError({
          code: 'invalid_config',
          message: 'Automation is not active.',
        }),
      )
    }

    const policyResult = parseConcurrencyPolicy(automation.concurrencyPolicy)
    if (policyResult.isErr()) return Result.err(policyResult.error)

    const runId = crypto.randomUUID()
    automationTriggerLogger.info('automation.trigger.dispatch_started', {
      userId: automation.createdBy,
      workspaceId: automation.workspaceId,
      agentId: automation.assigneeAgentId,
      automationId: automation.id,
      runId,
      triggerId: args.config.triggerId,
      source: args.source,
    })
    const startResult = await startAutomationRun(this.env, {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      triggerId: args.config.triggerId,
      source: args.source,
      runId,
      agentId: automation.assigneeAgentId,
      trigger: {
        correlationId: `automation:${runId}:${args.source}`,
      },
      actor: { type: 'system', id: 'automation' },
      payload: args.payload ?? null,
      contextSnapshot: {
        automation: {
          id: automation.id,
          title: automation.title,
          description: automation.description,
          system_prompt: automation.systemPrompt,
          input_schema: automation.inputSchema,
          context_sources: automation.contextSources,
          output_config: automation.outputConfig,
          execution_config: automation.executionConfig,
          tags: automation.tags,
          category: automation.category,
        },
      },
    })
    if (startResult.isErr()) {
      automationTriggerLogger.error('automation.trigger.dispatch_failed', {
        userId: automation.createdBy,
        workspaceId: automation.workspaceId,
        agentId: automation.assigneeAgentId,
        automationId: automation.id,
        runId,
        triggerId: args.config.triggerId,
        source: args.source,
        message: startResult.error.message,
      })
      const failedResult = await this.markRunFailed({
        runId,
        message: startResult.error.message,
      })
      if (failedResult.isErr()) return Result.err(failedResult.error)
      return Result.err(
        dispatchError('start automation run', startResult.error),
      )
    }

    const updateRunResult = await this.markRunStarted({
      runId,
      automationId: automation.id,
    })
    if (updateRunResult.isErr()) return Result.err(updateRunResult.error)

    this.setRunState({
      inFlightRunId: runId,
    })

    automationTriggerLogger.info('automation.trigger.dispatch_completed', {
      userId: automation.createdBy,
      workspaceId: automation.workspaceId,
      agentId: automation.assigneeAgentId,
      automationId: automation.id,
      runId,
      triggerId: args.config.triggerId,
      source: args.source,
    })

    return Result.ok({ runId })
  }

  private async loadAutomation(
    automationId: string,
  ): Promise<ResultValue<AutomationRow | null, AutomationDoError>> {
    const db = this.db()
    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await db
          .select({
            id: schema.automation.id,
            workspaceId: schema.automation.workspaceId,
            projectId: schema.automation.projectId,
            title: schema.automation.title,
            description: schema.automation.description,
            systemPrompt: schema.automation.systemPrompt,
            inputSchema: schema.automation.inputSchema,
            contextSources: schema.automation.contextSources,
            outputConfig: schema.automation.outputConfig,
            executionConfig: schema.automation.executionConfig,
            tags: schema.automation.tags,
            category: schema.automation.category,
            assigneeAgentId: schema.automation.assigneeAgentId,
            priority: schema.automation.priority,
            status: schema.automation.status,
            concurrencyPolicy: schema.automation.concurrencyPolicy,
            createdBy: schema.automation.createdBy,
            agentHostName: schema.agent.hostName,
          })
          .from(schema.automation)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.automation.assigneeAgentId),
          )
          .where(eq(schema.automation.id, automationId))
          .limit(1)
        return row ?? null
      },
      catch: (cause) => dbError('load automation', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    return Result.ok(result.value)
  }

  private async markRunFailed(args: {
    runId: string
    message: string
  }): Promise<ResultValue<void, AutomationDoError>> {
    const db = this.db()
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

  private async markRunStarted(args: {
    runId: string
    automationId: string
  }): Promise<ResultValue<void, AutomationDoError>> {
    const db = this.db()
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () => {
        await db
          .update(schema.automationRun)
          .set({
            status: 'queued',
            completedAt: null,
            updatedAt: now,
          })
          .where(eq(schema.automationRun.id, args.runId))
        await db
          .update(schema.automation)
          .set({ lastRunAt: now, updatedAt: now })
          .where(eq(schema.automation.id, args.automationId))
      },
      catch: (cause) => dbError('mark automation run started', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    return Result.ok()
  }

  private async scheduleNext(
    triggerId: string,
    firedAt: Date,
  ): Promise<ResultValue<Date | null, AutomationDoError>> {
    const rowResult = await this.loadTriggerSchedule(triggerId)
    if (rowResult.isErr()) return Result.err(rowResult.error)

    const row = rowResult.value
    if (
      !row ||
      !row.enabled ||
      row.kind !== 'schedule' ||
      row.automationStatus !== 'active'
    ) {
      const uninstallResult = await this.uninstallTrigger()
      if (uninstallResult.isErr()) return Result.err(uninstallResult.error)
      return Result.ok(null)
    }

    if (!row.cronExpression || !row.timezone) {
      return Result.err(
        automationDoError({
          code: 'invalid_config',
          message: 'Schedule trigger is missing cron expression or timezone.',
        }),
      )
    }

    const policyResult = parseConcurrencyPolicy(row.concurrencyPolicy)
    if (policyResult.isErr()) return Result.err(policyResult.error)

    const nextResult = nextRunFromCron({
      cronExpression: row.cronExpression,
      timezone: row.timezone,
      from: firedAt,
    })
    if (nextResult.isErr()) return Result.err(nextResult.error)

    const scheduledResult = await this.scheduleAutomationTrigger(
      {
        triggerId: row.triggerId,
        automationId: row.automationId,
        concurrencyPolicy: policyResult.value,
        scheduleId: this.getConfig()?.scheduleId ?? null,
      },
      nextResult.value,
    )
    if (scheduledResult.isErr()) return Result.err(scheduledResult.error)

    this.ctx.storage.kv.put(CONFIG_KEY, scheduledResult.value)

    return Result.ok(nextResult.value)
  }

  private async loadTriggerSchedule(
    triggerId: string,
  ): Promise<ResultValue<TriggerScheduleRow | null, AutomationDoError>> {
    const db = this.db()
    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await db
          .select({
            triggerId: schema.automationTrigger.id,
            automationId: schema.automationTrigger.automationId,
            enabled: schema.automationTrigger.enabled,
            kind: schema.automationTrigger.kind,
            cronExpression: schema.automationTrigger.cronExpression,
            timezone: schema.automationTrigger.timezone,
            automationStatus: schema.automation.status,
            concurrencyPolicy: schema.automation.concurrencyPolicy,
          })
          .from(schema.automationTrigger)
          .innerJoin(
            schema.automation,
            eq(schema.automation.id, schema.automationTrigger.automationId),
          )
          .where(eq(schema.automationTrigger.id, triggerId))
          .limit(1)
        return row ?? null
      },
      catch: (cause) => dbError('load automation trigger schedule', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    return Result.ok(result.value)
  }
}
