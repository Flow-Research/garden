import { Agent } from 'agents'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getPooledDb } from '@garden/db/runtime'
import {
  Result,
  TaggedError,
  type Result as ResultValue,
  type SerializedResult,
} from 'better-result'
import { CronExpressionParser } from 'cron-parser'
import { z } from 'zod'
import * as schema from '@garden/db/schema'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import {
  cancelAutomationRun,
  startAutomationRun,
  type AutomationRunEnv,
} from '@garden/server/automations/run-service'
import { errorMessage, operationFailedMessage } from './runtime-utils'

type AutomationTriggerEnv = Cloudflare.Env & AutomationRunEnv
type AutomationConcurrencyPolicy = 'skip' | 'replace'
type AutomationRunSource = 'schedule' | 'manual' | 'webhook' | 'api'
const LIVE_AUTOMATION_RUN_STATUSES = ['queued', 'running'] as const
const automationTriggerLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'automation-trigger-do',
})

/**
 * KV and schedule-payload values are read back from durable storage written
 * by earlier deployments, so they are validated rather than cast. Configs
 * written before `scheduleId` existed decode with `scheduleId: null`.
 */
const automationConfigSchema = z.object({
  triggerId: z.string().min(1),
  automationId: z.string().min(1),
  concurrencyPolicy: z.enum(['skip', 'replace']),
  scheduleId: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
})

const automationStateSchema = z.object({
  inFlightRunId: z.string().nullable(),
})

const rescheduleRetrySchema = z.object({
  triggerId: z.string().min(1),
  attempt: z.number().int().min(1),
})

/** The SDK passes the schedule row as the callback's second argument. */
const scheduleRowSchema = z.object({ id: z.string().min(1) })

type AutomationConfig = z.infer<typeof automationConfigSchema>

type AutomationState = z.infer<typeof automationStateSchema>

type RescheduleRetry = z.infer<typeof rescheduleRetrySchema>

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
const LAST_FIRED_SCHEDULE_KEY = 'lastFiredScheduleId'

const MIN_FIRST_FIRE_DELAY_MS = 10_000
const RESCHEDULE_RETRY_BASE_SECONDS = 60
const RESCHEDULE_RETRY_MAX_SECONDS = 60 * 60
const RETRYABLE_SCHEDULE_ERRORS: ReadonlySet<AutomationDoError['code']> =
  new Set(['db_error', 'schedule_error'])

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

function dbError(operation: string, cause: unknown) {
  return automationDoError({
    code: 'db_error',
    message: operationFailedMessage(operation, cause),
    cause,
  })
}

function dispatchError(operation: string, cause: unknown) {
  return automationDoError({
    code: 'dispatch_failed',
    message: operationFailedMessage(operation, cause),
    cause,
  })
}

function scheduleError(operation: string, cause: unknown) {
  return automationDoError({
    code: 'schedule_error',
    message: operationFailedMessage(operation, cause),
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
  /** Tail of the in-instance queue that serializes fires; see serializeFire. */
  private fireQueue: Promise<void> = Promise.resolve()

  /**
   * Resolves the automation-trigger Drizzle client through Hyperdrive's pooled
   * connection string. Previously called `drizzle(this.env.DATABASE_URL)` from
   * the neon-serverless driver, opening a fresh direct-to-Neon WebSocket pool
   * per call that bypassed Hyperdrive, never closed, and defeated Neon
   * autosuspend. `getPooledDb` memoizes one node-postgres pool per connection
   * string per isolate so Hyperdrive owns origin pooling.
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

    // The web app installs inside the transaction that writes the trigger and
    // commits only after this returns. A fire due sooner could find no trigger
    // row and uninstall itself, so the first fire waits for the commit.
    const firstRunAt = new Date(
      Math.max(nextRunAt.getTime(), Date.now() + MIN_FIRST_FIRE_DELAY_MS),
    )

    const existingConfig = this.getConfig()
    const scheduledResult = await this.scheduleAutomationTrigger(
      {
        triggerId: args.triggerId,
        automationId: args.automationId,
        concurrencyPolicy: policyResult.value,
        scheduleId: existingConfig?.scheduleId ?? null,
      },
      firstRunAt,
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
    this.ctx.storage.kv.delete(LAST_FIRED_SCHEDULE_KEY)

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

    // Manual, webhook and API runs are not subject to the schedule's
    // concurrency policy (they normally bypass this DO entirely, see
    // docs/core/workflows-engine.md), so they are not tracked as the
    // in-flight run either. Previously this overwrote inFlightRunId, which
    // made the policy lose track of a still-running scheduled run.
    return await this.serializeFire(() =>
      this.dispatch({
        config,
        source: args.source,
        payload: args.payload,
        trackInFlight: false,
      }),
    )
  }

  /**
   * Invoked by the Agents SDK schedule row created for the trigger. Garden
   * still computes timezone-aware next run dates itself, but Cloudflare now
   * owns alarm dispatch, retries, and schedule bookkeeping instead of our DO
   * writing raw alarms directly. The SDK deletes the one-shot row once this
   * returns, so the next fire is always booked here (see `bookNextRun`).
   */
  async fireScheduledTrigger(
    rawPayload: unknown,
    rawRow?: unknown,
  ): Promise<void> {
    const parsed = automationConfigSchema.safeParse(rawPayload)
    if (!parsed.success) {
      automationTriggerLogger.error('automation_trigger.invalid_payload', {
        errorMessage: parsed.error.message,
      })
      return
    }
    const config = this.getConfig()
    if (!config || config.triggerId !== parsed.data.triggerId) return

    // The SDK retries a callback that throws, so a redelivered schedule row
    // must not dispatch its run a second time.
    const scheduleId = scheduleRowSchema.safeParse(rawRow).data?.id ?? null
    const alreadyFired =
      scheduleId !== null &&
      this.ctx.storage.kv.get(LAST_FIRED_SCHEDULE_KEY) === scheduleId
    if (!alreadyFired) {
      if (scheduleId)
        this.ctx.storage.kv.put(LAST_FIRED_SCHEDULE_KEY, scheduleId)
      const fireResult = await this.serializeFire(() =>
        this.fireScheduledRun(config),
      )
      // A failed fire is recorded on its run; the schedule carries on.
      if (fireResult.isErr()) {
        automationTriggerLogger.error('automation_trigger.fire_failed', {
          automationId: config.automationId,
          triggerId: config.triggerId,
          ...errorFields(fireResult.error),
        })
      }
    }

    await this.bookNextRun(config.triggerId, 1)
  }

  /**
   * Invoked by the retry wakeup that `bookNextRun` stores when the next cron
   * fire could not be booked.
   */
  async retryScheduleNext(rawPayload: unknown): Promise<void> {
    const parsed = rescheduleRetrySchema.safeParse(rawPayload)
    if (!parsed.success) {
      automationTriggerLogger.error('automation_trigger.invalid_payload', {
        errorMessage: parsed.error.message,
      })
      return
    }
    const config = this.getConfig()
    if (!config || config.triggerId !== parsed.data.triggerId) return

    await this.bookNextRun(parsed.data.triggerId, parsed.data.attempt)
  }

  /**
   * Books the trigger's next cron fire. Each SDK schedule fires once and is
   * deleted afterwards, so a failed booking used to end the automation. A
   * transient failure (the database or the schedule store) now stores a retry
   * wakeup in its place, backing off exponentially, so the automation is never
   * left without a pending schedule. Configuration errors are not retried:
   * they only heal when the trigger is edited, which reinstalls it. Throws only
   * when even the retry cannot be stored, so the SDK retries the callback.
   */
  private async bookNextRun(triggerId: string, attempt: number) {
    const nextResult = await this.scheduleNext(triggerId, new Date())
    if (nextResult.isOk()) return

    const retryable = RETRYABLE_SCHEDULE_ERRORS.has(nextResult.error.code)
    const retryInSeconds = Math.min(
      RESCHEDULE_RETRY_BASE_SECONDS * 2 ** (attempt - 1),
      RESCHEDULE_RETRY_MAX_SECONDS,
    )
    automationTriggerLogger.error('automation_trigger.reschedule_failed', {
      triggerId,
      attempt,
      ...(retryable ? { retryInSeconds } : {}),
      ...errorFields(nextResult.error),
    })
    if (!retryable) return

    const retryResult = await this.scheduleRescheduleRetry({
      triggerId,
      attempt: attempt + 1,
      delaySeconds: retryInSeconds,
    })
    if (retryResult.isErr()) throw retryResult.error
  }

  private async scheduleRescheduleRetry(args: {
    triggerId: string
    attempt: number
    delaySeconds: number
  }): Promise<ResultValue<void, AutomationDoError>> {
    const config = this.getConfig()
    if (!config || config.triggerId !== args.triggerId) return Result.ok()

    const cancelResult = await this.cancelAutomationSchedule(config)
    if (cancelResult.isErr()) return Result.err(cancelResult.error)

    const result = await Result.tryPromise({
      try: async () =>
        await this.schedule(args.delaySeconds, 'retryScheduleNext', {
          triggerId: args.triggerId,
          attempt: args.attempt,
        } satisfies RescheduleRetry),
      catch: (cause) => scheduleError('schedule automation retry', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    this.ctx.storage.kv.put(CONFIG_KEY, {
      ...config,
      scheduleId: result.value.id,
    } satisfies AutomationConfig)
    return Result.ok()
  }

  private async fireScheduledRun(
    config: AutomationConfig,
  ): Promise<ResultValue<void, AutomationDoError>> {
    const policyResult = await this.applyConcurrencyPolicy(config)
    if (policyResult.isErr()) return Result.err(policyResult.error)

    if (policyResult.value === 'skip') {
      const skippedResult = await this.recordSkippedRun(config)
      return skippedResult.isErr()
        ? Result.err(skippedResult.error)
        : Result.ok()
    }

    const dispatchResult = await this.dispatch({
      config,
      source: 'schedule',
      trackInFlight: true,
    })
    if (dispatchResult.isErr()) return Result.err(dispatchResult.error)

    return Result.ok()
  }

  /**
   * Runs one fire (policy check plus dispatch) at a time. Both span several
   * awaits, and a Durable Object interleaves requests at network awaits, so
   * two fires used to be able to read the same in-flight state and both
   * start a run.
   */
  private serializeFire<T>(fire: () => Promise<T>): Promise<T> {
    const next = this.fireQueue.then(fire, fire)
    this.fireQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private getConfig(): AutomationConfig | null {
    const stored: unknown = this.ctx.storage.kv.get(CONFIG_KEY)
    if (stored === undefined || stored === null) return null
    const parsed = automationConfigSchema.safeParse(stored)
    if (parsed.success) return parsed.data
    automationTriggerLogger.error('automation_trigger.invalid_config', {
      errorMessage: parsed.error.message,
    })
    return null
  }

  private getRunState(): AutomationState {
    const stored: unknown = this.ctx.storage.kv.get(STATE_KEY)
    if (stored === undefined || stored === null) return emptyState()
    const parsed = automationStateSchema.safeParse(stored)
    if (parsed.success) return parsed.data
    automationTriggerLogger.warn('automation_trigger.invalid_state', {
      errorMessage: parsed.error.message,
    })
    return emptyState()
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

    const updateResult = await this.markAutomationRunReplaced(run.id)
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
    runId: string,
  ): Promise<ResultValue<void, AutomationDoError>> {
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
          .where(
            and(
              eq(schema.automationRun.id, runId),
              inArray(
                schema.automationRun.status,
                LIVE_AUTOMATION_RUN_STATUSES,
              ),
            ),
          )
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
    const scheduleId = config?.scheduleId
    if (!scheduleId) return Result.ok()

    const result = await Result.tryPromise({
      try: async () => await this.cancelSchedule(scheduleId),
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

  /**
   * Starts one automation run. For tracked (scheduled) dispatches the run id
   * is reserved as `inFlightRunId` synchronously, before the first await, so
   * no other fire can observe an empty slot while this one is starting; the
   * reservation is released again if the run does not start.
   */
  private async dispatch(args: {
    config: AutomationConfig
    source: AutomationRunSource
    payload?: unknown
    trackInFlight: boolean
  }): Promise<ResultValue<{ runId: string }, AutomationDoError>> {
    const runId = crypto.randomUUID()
    if (!args.trackInFlight) return await this.startRun({ ...args, runId })

    this.setRunState({ inFlightRunId: runId })
    const result = await this.startRun({ ...args, runId })
    if (result.isErr() && this.getRunState().inFlightRunId === runId) {
      this.clearInFlightState()
    }
    return result
  }

  private async startRun(args: {
    config: AutomationConfig
    source: AutomationRunSource
    payload?: unknown
    runId: string
  }): Promise<ResultValue<{ runId: string }, AutomationDoError>> {
    const runId = args.runId
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
          .where(
            and(
              eq(schema.automationRun.id, args.runId),
              inArray(
                schema.automationRun.status,
                LIVE_AUTOMATION_RUN_STATUSES,
              ),
            ),
          )
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
        const [startedRun] = await db
          .update(schema.automationRun)
          .set({
            status: 'queued',
            completedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.automationRun.id, args.runId),
              eq(schema.automationRun.status, 'queued'),
            ),
          )
          .returning({ id: schema.automationRun.id })
        if (!startedRun) return false
        await db
          .update(schema.automation)
          .set({ lastRunAt: now, updatedAt: now })
          .where(eq(schema.automation.id, args.automationId))
        return true
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
