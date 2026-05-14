import {
  Session,
  Think,
  type ChatResponseResult,
  type SaveMessagesResult,
  type StepContext,
  type ToolCallContext,
  type TurnConfig,
  type TurnContext,
} from '@cloudflare/think'
import { Workspace } from '@cloudflare/shell'
import { getSandbox, type Sandbox as SandboxDO } from '@cloudflare/sandbox'
import { tool, type LanguageModel, type ToolSet, type UIMessage } from 'ai'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { z } from 'zod'
import { connectorRegistry } from '@garden/connectors'
import {
  derivePermissions,
  type AgentPermissions,
} from '@garden/core/agents/permissions'
import * as schema from '@garden/db/schema'
import { createAgentModel } from './model'
import {
  RuntimeMcpConnectionPreparer,
  RuntimeMcpController,
  RuntimeMcpError,
  connectRpcMcpConnector,
  type McpHost,
  type RuntimeMcpServerStates,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'
import { mcpRuntimeConfig } from './mcp-runtime-config'
import { assembleFoundationPrompt } from './prompt'
import { createSandboxTools } from './sandbox-tools'
import {
  addStepUsage,
  normalizeRunUsage,
  type RunUsageSnapshot,
} from './run-usage'

type AgentRuntimeEnv = Cloudflare.Env & {
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  DATABASE_URL: string
  CLOUDFLARE_ACCOUNT_ID: string
  CF_AIG_TOKEN: string
  FILES: R2Bucket
  LOADER: WorkerLoader
  Sandbox: DurableObjectNamespace<SandboxDO>
  MCP_SESSION: DurableObjectNamespace
}

type TurnMode = 'start' | 'resume'

type StartTurnInput = {
  runId: string
}

type LoadedAutomationRunContext = {
  contextBlock: string
  permissions: AgentPermissions
  run: typeof schema.automationRun.$inferSelect
  automation: typeof schema.automation.$inferSelect
  agent: {
    id: string
    name: string
    roleTitle: string | null
    ownerUserId: string
    runTimeoutSec: number
    permissions: unknown
  }
}

type AutomationRunContextSnapshot = {
  source?: string
  payload?: unknown
}

const DEFAULT_AUTOMATION_RUN_TIMEOUT_SEC = 2 * 60 * 60
const THINK_TURN_MAX_RETRIES = 1
const THINK_TURN_TELEMETRY_FUNCTION_ID = 'garden.automation-run.turn'
const ACTIVE_AUTOMATION_RUN_STATUSES = ['queued', 'running'] as const
const TERMINAL_AUTOMATION_RUN_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'skipped',
] as const

const completeAutomationInputSchema = z
  .object({
    output: z
      .string()
      .trim()
      .min(1)
      .max(50_000)
      .describe('Final automation output for the run ledger.'),
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Optional structured result data for downstream consumers.'),
  })
  .strict()

class AutomationRunSubAgentError extends TaggedError(
  'AutomationRunSubAgentError',
)<{
  code: 'database_failed' | 'invalid_state' | 'not_found' | 'runtime_failed'
  message: string
  cause?: unknown
}>() {}

class AutomationRunTurnStopped extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationRunTurnStopped'
  }
}

function dbError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new AutomationRunSubAgentError({
    code: 'database_failed',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

function isActiveAutomationRunStatus(status: string) {
  return (ACTIVE_AUTOMATION_RUN_STATUSES as readonly string[]).includes(status)
}

function isTerminalAutomationRunStatus(status: string) {
  return (TERMINAL_AUTOMATION_RUN_STATUSES as readonly string[]).includes(
    status,
  )
}

export class AutomationRunSubAgent extends Think<AgentRuntimeEnv> {
  constructor(ctx: DurableObjectState, env: AgentRuntimeEnv) {
    super(ctx, env)
  }

  override chatRecovery = false

  waitForMcpConnections = {
    timeout: mcpRuntimeConfig.connectionWaitTimeoutMs,
  }

  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.FILES,
    name: () => this.name,
  })

  private currentRunId: string | null = null
  private currentPermissions: AgentPermissions | null = null
  private aggUsage: RunUsageSnapshot | null = null
  private readonly mcpConnectionPreparer = new RuntimeMcpConnectionPreparer({
    getController: () => this.getMcpController(),
    fullSyncIntervalMs: mcpRuntimeConfig.connectorFullSyncIntervalMs,
    waitForConnections: async (timeoutMs) =>
      await this.mcp.waitForConnections({ timeout: timeoutMs }),
    getServerStates: () =>
      this.getMcpServers().servers as RuntimeMcpServerStates,
    connectionWaitTimeoutMs: mcpRuntimeConfig.connectionWaitTimeoutMs,
    backgroundRefreshFailedMessage:
      '[agent-runtime] automation MCP background refresh failed',
    refreshFailedMessage:
      '[agent-runtime] automation MCP connector refresh failed',
    continuingWithoutReadyMessage:
      '[agent-runtime] automation MCP connectors are not ready',
    readinessPolicy: 'required',
  })

  maxSteps = 30

  getModel(): LanguageModel {
    return createAgentModel({
      accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
      apiKey: this.env.CF_AIG_TOKEN,
    })
  }

  override async configureSession(session: Session) {
    return session
      .withContext('foundation', {
        description:
          'Base Garden operating contract. Later context refines this but does not override it.',
        provider: {
          get: async () => assembleFoundationPrompt(),
        },
      })
      .withContext('automation-run', {
        description:
          'Standalone automation-run behavior and output discipline.',
        provider: {
          get: async () =>
            [
              'You are executing a standalone Garden automation.',
              'This is not an issue, should not create a kanban card, and has no issue timeline.',
              'Complete the configured automation task directly, then call complete_automation exactly once with a non-empty output.',
              'Do not call complete_automation until required connector/tool work is finished.',
              'Only inspect or modify Garden issues when the automation prompt explicitly asks for issue work.',
            ].join('\n'),
        },
      })
      .withCachedPrompt()
  }

  override getTools(): ToolSet {
    return {
      complete_automation: tool({
        description:
          'Finish this standalone automation run with the final output. Does not create issues, comments, or kanban cards.',
        inputSchema: completeAutomationInputSchema,
        execute: async (input) => {
          const runId = this.currentRunId
          if (!runId) {
            return {
              ok: false,
              error: 'Automation completion called outside an active run.',
            }
          }

          const completeResult = await this.finishCompleted(runId, {
            output: input.output,
            data: input.data ?? null,
            source: 'complete_automation',
          })
          if (completeResult.isErr()) {
            return { ok: false, error: completeResult.error.message }
          }

          return { ok: true, status: 'completed' }
        },
      }),
      ...createSandboxTools(() => this.getAgentSandbox()),
    }
  }

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig | void> {
    const bodyRunId = ctx.body?.run_id
    const runId =
      this.currentRunId ??
      (typeof bodyRunId === 'string' && bodyRunId.trim()
        ? bodyRunId.trim()
        : null)
    if (!runId) {
      throw new Error('AutomationRunSubAgent.beforeTurn missing run_id.')
    }

    const loadedResult = await this.loadTurnContext(runId)
    if (loadedResult.isErr()) throw loadedResult.error

    const guardResult = await this.applyRunBoundaryGuards(loadedResult.value)
    if (guardResult.isErr()) throw guardResult.error
    if (guardResult.value !== 'continue') {
      throw new AutomationRunTurnStopped(guardResult.value)
    }

    this.currentRunId = runId
    this.currentPermissions = loadedResult.value.permissions
    this.aggUsage = null

    const mcpController = await this.ensureProxyMcpConnectionsForTurn()
    const observedChangesResult = mcpController.captureObservedMcpToolChanges()
    if (observedChangesResult.isErr()) {
      console.warn(
        '[agent-runtime] failed to capture MCP tool changes for automation run',
        observedChangesResult.error,
      )
    }

    return {
      experimental_telemetry: {
        functionId: THINK_TURN_TELEMETRY_FUNCTION_ID,
        isEnabled: true,
        metadata: {
          agentClass: 'AutomationRunSubAgent',
          runId,
        },
        recordInputs: false,
        recordOutputs: false,
      },
      maxRetries: THINK_TURN_MAX_RETRIES,
      maxSteps: this.maxSteps,
      sendReasoning: true,
      system: `${ctx.system}\n\n${loadedResult.value.contextBlock}`,
      tools: mcpController.wrapGetAITools(
        this.mcp.getAITools.bind(this.mcp),
        undefined,
        {
          shouldAutoApprove: ({ riskClass }) =>
            this.shouldAutoApproveRiskClass(riskClass),
        },
      ),
    } satisfies TurnConfig
  }

  override async beforeToolCall(ctx: ToolCallContext) {
    const activeResult = await this.assertRunActiveForTool()
    if (activeResult.isErr()) throw activeResult.error

    const gateResult = this.assertToolAllowed(ctx.toolName)
    if (gateResult.isErr()) throw gateResult.error

    return undefined
  }

  override async onStepFinish(ctx: StepContext) {
    const runId = this.currentRunId
    if (!runId) return

    const nextUsage = addStepUsage(this.aggUsage, ctx)
    this.aggUsage = nextUsage

    const persistResult = await this.persistUsage(runId, nextUsage)
    if (persistResult.isErr()) {
      console.warn('[agent-runtime] failed to persist automation run usage', {
        error: persistResult.error.message,
        runId,
      })
    }
  }

  override async onChatResponse(result: ChatResponseResult) {
    const runId = this.currentRunId
    if (!runId) return

    if (this.aggUsage) {
      const usageResult = await this.persistUsage(runId, this.aggUsage)
      if (usageResult.isErr()) {
        console.warn('[agent-runtime] failed to persist final usage', {
          error: usageResult.error.message,
          runId,
        })
      }
    }

    if (result.status === 'aborted') {
      const cancelResult = await this.cancelRunIfRequested(runId)
      if (cancelResult.isErr()) {
        console.warn(
          '[agent-runtime] failed to apply automation run cancellation',
          { error: cancelResult.error.message, runId },
        )
      } else if (!cancelResult.value) {
        const failedResult = await this.forceCloseFailed(runId, 'turn_aborted')
        if (failedResult.isErr()) {
          console.warn(
            '[agent-runtime] failed to close aborted automation run',
            { error: failedResult.error.message, runId },
          )
        }
      }
      this.clearTurnState()
      return
    }

    if (result.status === 'error') {
      const failedResult = await this.forceCloseFailed(
        runId,
        result.error ?? 'chat_error',
      )
      if (failedResult.isErr()) {
        console.warn('[agent-runtime] failed to close errored automation run', {
          error: failedResult.error.message,
          runId,
        })
      }
      this.clearTurnState()
      return
    }

    const statusResult = await this.readRunStatus(runId)
    if (
      statusResult.isOk() &&
      isTerminalAutomationRunStatus(statusResult.value)
    ) {
      this.clearTurnState()
      return
    }

    const output = result.message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join('\n\n')
    if (!output) {
      const failedResult = await this.forceCloseFailed(
        runId,
        'automation_completed_without_output',
      )
      if (failedResult.isErr()) {
        console.warn(
          '[agent-runtime] failed to close empty automation response',
          {
            error: failedResult.error.message,
            runId,
          },
        )
      }
      this.clearTurnState()
      return
    }

    const completeResult = await this.finishCompleted(runId, {
      output,
      data: null,
      source: 'assistant',
    })
    if (completeResult.isErr()) {
      console.warn('[agent-runtime] failed to complete automation run', {
        error: completeResult.error.message,
        runId,
      })
    }
    this.clearTurnState()
  }

  async executeWorkflowTurn(
    mode: TurnMode,
    input: StartTurnInput,
  ): Promise<{ status: string }> {
    const [runRow] = await this.getDb()
      .select({
        cancelRequestedAt: schema.automationRun.cancelRequestedAt,
        status: schema.automationRun.status,
      })
      .from(schema.automationRun)
      .where(eq(schema.automationRun.id, input.runId))
      .limit(1)

    if (runRow?.cancelRequestedAt) {
      const cancelResult = await this.finishCancelled(input.runId, 'cancelled')
      if (cancelResult.isErr()) {
        await this.forceCloseFailed(input.runId, cancelResult.error.message)
        throw new Error(cancelResult.error.message)
      }
      return { status: 'cancelled' }
    }

    const driveResult = await this.driveTurn(mode, input)
    if (driveResult.isErr()) {
      await this.forceCloseFailed(input.runId, driveResult.error.message)
      throw new Error(driveResult.error.message)
    }
    if (driveResult.value === 'aborted') {
      const cancelResult = await this.cancelRunIfRequested(input.runId)
      if (cancelResult.isErr()) {
        await this.forceCloseFailed(input.runId, cancelResult.error.message)
        throw new Error(cancelResult.error.message)
      }
      if (!cancelResult.value) {
        const failedResult = await this.forceCloseFailed(
          input.runId,
          'turn_aborted',
        )
        if (failedResult.isErr()) {
          throw new Error(failedResult.error.message)
        }
      }
    }
    if (driveResult.value === 'skipped') {
      const failedResult = await this.forceCloseFailed(
        input.runId,
        'turn_skipped',
      )
      if (failedResult.isErr()) {
        throw new Error(failedResult.error.message)
      }
    }

    const statusResult = await this.readRunStatus(input.runId)
    if (statusResult.isErr()) {
      await this.forceCloseFailed(input.runId, statusResult.error.message)
      throw new Error(statusResult.error.message)
    }
    return { status: statusResult.value }
  }

  async requestCancel(input: StartTurnInput): Promise<void> {
    const cancelResult = await this.setCancelRequested(input.runId, 'cancelled')
    if (cancelResult.isErr()) {
      console.warn(
        '[agent-runtime] failed to request automation cancellation',
        {
          error: cancelResult.error.message,
          runId: input.runId,
        },
      )
    }
    this.abortAllRequests()
  }

  private async driveTurn(
    mode: TurnMode,
    input: StartTurnInput,
  ): Promise<
    ResultValue<
      SaveMessagesResult['status'] | 'stopped',
      AutomationRunSubAgentError
    >
  > {
    const loadedResult = await this.loadTurnContext(input.runId)
    if (loadedResult.isErr()) return Result.err(loadedResult.error)

    const boundaryResult = await this.applyRunBoundaryGuards(loadedResult.value)
    if (boundaryResult.isErr()) return Result.err(boundaryResult.error)
    if (boundaryResult.value !== 'continue') return Result.ok('stopped')

    const statusResult =
      mode === 'start'
        ? await this.markRunStarted(loadedResult.value)
        : await this.markRunResumed(loadedResult.value)
    if (statusResult.isErr()) return Result.err(statusResult.error)

    this.currentRunId = input.runId
    this.currentPermissions = loadedResult.value.permissions

    const message: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [
        {
          type: 'text',
          text:
            mode === 'resume'
              ? 'Resume this automation run using the injected automation context. Complete required work, then call complete_automation with the final result.'
              : 'Start this automation run using the injected automation context. Complete the task directly, then call complete_automation. Do not create, update, or comment on issues unless the automation prompt explicitly asks you to inspect existing issues.',
        },
      ],
    }

    const saveResult = await Result.tryPromise({
      try: async () => await this.saveMessages([message]),
      catch: (cause) => cause,
    })
    if (saveResult.isErr()) {
      if (saveResult.error instanceof AutomationRunTurnStopped) {
        return Result.ok('stopped')
      }
      return Result.err(
        new AutomationRunSubAgentError({
          code: 'runtime_failed',
          message:
            saveResult.error instanceof Error
              ? saveResult.error.message
              : String(saveResult.error),
          cause: saveResult.error,
        }),
      )
    }

    return Result.ok(saveResult.value.status)
  }

  private getDb() {
    return drizzle(this.env.DATABASE_URL, { schema })
  }

  private getSandboxId() {
    const pathKey = this.selfPath.map((segment) => segment.name).join('-')
    const candidate = pathKey || this.name
    if (candidate.length <= 63) {
      return candidate
    }

    return [
      this.compactSandboxSegment(
        this.parentPath.at(-1)?.name || 'agent-do',
        20,
      ),
      this.compactSandboxSegment(this.name, 20),
      this.hashSandboxId(candidate),
    ].join('-')
  }

  private compactSandboxSegment(value: string, maxLength: number) {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    if (!normalized) {
      return 'sandbox'
    }

    return normalized.slice(0, maxLength)
  }

  private hashSandboxId(value: string) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }

    return (hash >>> 0).toString(16)
  }

  private getAgentSandbox() {
    return getSandbox(this.env.Sandbox, this.getSandboxId(), {
      normalizeId: true,
      sleepAfter: '5m',
      transport: 'rpc',
    })
  }

  private connectorToolForName(toolName: string) {
    for (const connector of connectorRegistry) {
      const prefix = `tool_${connector.id.replace(/-/g, '')}_`
      if (toolName.startsWith(prefix)) {
        return {
          connectorId: connector.id,
          toolName: toolName.slice(prefix.length),
        }
      }
    }
    return null
  }

  private assertToolAllowed(
    runtimeToolName: string,
  ): ResultValue<void, AutomationRunSubAgentError> {
    if (runtimeToolName === 'complete_automation') return Result.ok()

    const permissions = this.currentPermissions
    if (!permissions || permissions.full_access) return Result.ok()

    const connectorTool = this.connectorToolForName(runtimeToolName)
    const toolName = connectorTool?.toolName ?? runtimeToolName

    if (
      permissions.allowed_tools.length > 0 &&
      !permissions.allowed_tools.includes(toolName) &&
      !permissions.allowed_tools.includes(runtimeToolName)
    ) {
      return Result.err(
        new AutomationRunSubAgentError({
          code: 'runtime_failed',
          message: `Tool ${toolName} is not allowed for this agent.`,
        }),
      )
    }

    if (
      connectorTool &&
      permissions.allowed_connectors.length > 0 &&
      !permissions.allowed_connectors.includes(connectorTool.connectorId)
    ) {
      return Result.err(
        new AutomationRunSubAgentError({
          code: 'runtime_failed',
          message: `Connector ${connectorTool.connectorId} is not allowed for this agent.`,
        }),
      )
    }

    return Result.ok()
  }

  private shouldAutoApproveRiskClass(riskClass: string) {
    const permissions = this.currentPermissions
    if (!permissions) return false
    if (riskClass !== 'send_external' && riskClass !== 'destructive') {
      return false
    }
    return permissions.approval_overrides[riskClass] === 'auto'
  }

  private async assertRunActiveForTool(): Promise<
    ResultValue<void, AutomationRunSubAgentError>
  > {
    const runId = this.currentRunId
    if (!runId) {
      return Result.err(
        new AutomationRunSubAgentError({
          code: 'invalid_state',
          message: 'Automation tool called outside an active run.',
        }),
      )
    }
    const result = await this.readRunStatus(runId)
    if (result.isErr()) return Result.err(result.error)
    if (isActiveAutomationRunStatus(result.value)) return Result.ok()

    return Result.err(
      new AutomationRunSubAgentError({
        code: 'invalid_state',
        message: `Automation run is no longer active (${result.value}).`,
      }),
    )
  }

  private async readRunStatus(
    runId: string,
  ): Promise<ResultValue<string, AutomationRunSubAgentError>> {
    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await this.getDb()
          .select({ status: schema.automationRun.status })
          .from(schema.automationRun)
          .where(eq(schema.automationRun.id, runId))
          .limit(1)
        return row?.status ?? 'unknown'
      },
      catch: (cause) => dbError('load automation run status', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok(result.value)
  }

  private async loadTurnContext(
    runId: string,
  ): Promise<
    ResultValue<LoadedAutomationRunContext, AutomationRunSubAgentError>
  > {
    const db = this.getDb()
    const result = await Result.tryPromise({
      try: async () => {
        const [runRow] = await db
          .select({
            run: schema.automationRun,
            automation: schema.automation,
            agent: {
              id: schema.agent.id,
              name: schema.agent.name,
              roleTitle: schema.agent.roleTitle,
              ownerUserId: schema.agent.ownerUserId,
              runTimeoutSec: schema.agent.runTimeoutSec,
              permissions: schema.agent.permissions,
            },
          })
          .from(schema.automationRun)
          .innerJoin(
            schema.automation,
            eq(schema.automation.id, schema.automationRun.automationId),
          )
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.automationRun.agentId),
          )
          .where(eq(schema.automationRun.id, runId))
          .limit(1)

        if (!runRow) return null

        const [recentRuns, availableAgents] = await Promise.all([
          db
            .select()
            .from(schema.automationRun)
            .where(eq(schema.automationRun.automationId, runRow.automation.id))
            .orderBy(desc(schema.automationRun.triggeredAt))
            .limit(10),
          db
            .select({
              id: schema.agent.id,
              name: schema.agent.name,
              roleTitle: schema.agent.roleTitle,
            })
            .from(schema.agent)
            .where(
              and(
                eq(schema.agent.workspaceId, runRow.automation.workspaceId),
                inArray(schema.agent.status, ['active', 'pending_approval']),
              ),
            )
            .orderBy(asc(schema.agent.name)),
        ])

        return {
          runRow,
          recentRuns,
          availableAgents,
        }
      },
      catch: (cause) => dbError('load automation turn context', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    if (!result.value) {
      return Result.err(
        new AutomationRunSubAgentError({
          code: 'not_found',
          message: 'Automation run not found.',
        }),
      )
    }

    const row = result.value
    const context = row.runRow.run
      .contextSnapshot as AutomationRunContextSnapshot | null
    const source =
      typeof context?.source === 'string' && context.source.trim()
        ? context.source.trim()
        : row.runRow.run.source
    const triggerReason =
      source === 'schedule'
        ? 'A schedule triggered this automation.'
        : source === 'manual'
          ? 'A workspace member manually triggered this automation.'
          : `This automation was triggered by ${source}.`

    return Result.ok({
      permissions: derivePermissions({
        agent: row.runRow.agent,
        issue: null,
      }),
      run: row.runRow.run,
      automation: row.runRow.automation,
      agent: row.runRow.agent,
      contextBlock: this.renderContextBlock({
        triggerReason,
        run: row.runRow.run,
        automation: row.runRow.automation,
        agent: row.runRow.agent,
        recentRuns: row.recentRuns,
        availableAgents: row.availableAgents,
      }),
    })
  }

  private renderContextBlock(input: {
    triggerReason: string
    run: typeof schema.automationRun.$inferSelect
    automation: typeof schema.automation.$inferSelect
    agent: {
      id: string
      name: string
      roleTitle: string | null
      ownerUserId: string
      runTimeoutSec: number
      permissions?: unknown
    }
    recentRuns: Array<typeof schema.automationRun.$inferSelect>
    availableAgents: Array<{
      id: string
      name: string
      roleTitle: string | null
    }>
  }) {
    const context = input.run
      .contextSnapshot as AutomationRunContextSnapshot | null
    const payload = context?.payload ?? null
    const recentRuns = input.recentRuns.map((run) => ({
      id: run.id,
      source: run.source,
      status: run.status,
      failure_reason: run.failureReason ?? null,
      triggered_at: run.triggeredAt?.toISOString() ?? null,
      completed_at: run.completedAt?.toISOString() ?? null,
    }))
    const availableAgents = input.availableAgents.map((agent) => ({
      name: agent.name,
      role: agent.roleTitle ?? 'Workspace agent',
    }))

    return [
      '# Automation run context',
      '',
      'This is a standalone automation run. It is not an issue and should not create a kanban card.',
      input.triggerReason,
      '',
      [
        '## Current run',
        JSON.stringify(
          {
            id: input.run.id,
            status: input.run.status,
            source: input.run.source,
            started_at: input.run.startedAt?.toISOString() ?? null,
            cancel_requested_at:
              input.run.cancelRequestedAt?.toISOString() ?? null,
            run_timeout_sec: input.agent.runTimeoutSec,
          },
          null,
          2,
        ),
      ].join('\n'),
      [
        '## Automation',
        JSON.stringify(
          {
            id: input.automation.id,
            title: input.automation.title,
            prompt: input.automation.description ?? '',
            system_prompt: input.automation.systemPrompt ?? null,
            input_schema: input.automation.inputSchema ?? null,
            output_config: input.automation.outputConfig ?? null,
            execution_config: input.automation.executionConfig ?? null,
            tags: input.automation.tags,
            category: input.automation.category,
          },
          null,
          2,
        ),
      ].join('\n'),
      ['## Trigger payload', JSON.stringify(payload, null, 2)].join('\n'),
      ['## Recent automation runs', JSON.stringify(recentRuns, null, 2)].join(
        '\n',
      ),
      ['## Available agents', JSON.stringify(availableAgents, null, 2)].join(
        '\n',
      ),
    ].join('\n\n')
  }

  private async applyRunBoundaryGuards(
    loaded: LoadedAutomationRunContext,
  ): Promise<
    ResultValue<
      'continue' | 'cancelled' | 'timeout',
      AutomationRunSubAgentError
    >
  > {
    if (!isActiveAutomationRunStatus(loaded.run.status)) {
      return Result.ok('cancelled')
    }

    if (loaded.run.cancelRequestedAt) {
      const cancelResult = await this.finishCancelled(
        loaded.run.id,
        'cancelled',
      )
      if (cancelResult.isErr()) return Result.err(cancelResult.error)
      return Result.ok('cancelled')
    }

    const timeoutSec = await this.loadRunTimeoutSec(loaded.run.agentId)
    if (timeoutSec.isErr()) return Result.err(timeoutSec.error)
    const startedAt = loaded.run.startedAt ?? loaded.run.createdAt
    const elapsedMs = startedAt ? Date.now() - startedAt.getTime() : 0
    if (elapsedMs > timeoutSec.value * 1000) {
      const cancelResult = await this.setCancelRequested(
        loaded.run.id,
        'timeout',
      )
      if (cancelResult.isErr()) return Result.err(cancelResult.error)
      const failedResult = await this.forceCloseFailed(loaded.run.id, 'timeout')
      if (failedResult.isErr()) return Result.err(failedResult.error)
      return Result.ok('timeout')
    }

    return Result.ok('continue')
  }

  private async loadRunTimeoutSec(
    agentId: string,
  ): Promise<ResultValue<number, AutomationRunSubAgentError>> {
    const result = await Result.tryPromise({
      try: async () => {
        const [agent] = await this.getDb()
          .select({ runTimeoutSec: schema.agent.runTimeoutSec })
          .from(schema.agent)
          .where(eq(schema.agent.id, agentId))
          .limit(1)
        return Math.max(
          agent?.runTimeoutSec ?? DEFAULT_AUTOMATION_RUN_TIMEOUT_SEC,
          DEFAULT_AUTOMATION_RUN_TIMEOUT_SEC,
        )
      },
      catch: (cause) => dbError('load automation run timeout', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok(result.value)
  }

  private async markRunStarted(
    loaded: LoadedAutomationRunContext,
  ): Promise<ResultValue<void, AutomationRunSubAgentError>> {
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(schema.automationRun)
          .set({
            status: 'running',
            startedAt: loaded.run.startedAt ?? now,
            updatedAt: now,
          })
          .where(eq(schema.automationRun.id, loaded.run.id))
      },
      catch: (cause) => dbError('mark automation run started', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok()
  }

  private async markRunResumed(
    loaded: LoadedAutomationRunContext,
  ): Promise<ResultValue<void, AutomationRunSubAgentError>> {
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(schema.automationRun)
          .set({ status: 'running', updatedAt: now })
          .where(eq(schema.automationRun.id, loaded.run.id))
      },
      catch: (cause) => dbError('mark automation run resumed', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok()
  }

  private async persistUsage(
    runId: string,
    usage: RunUsageSnapshot,
  ): Promise<ResultValue<void, AutomationRunSubAgentError>> {
    const normalizedUsage = normalizeRunUsage(usage)
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(schema.automationRun)
          .set({ usageJson: normalizedUsage, updatedAt: new Date() })
          .where(eq(schema.automationRun.id, runId))
      },
      catch: (cause) => dbError('persist automation run usage', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok()
  }

  private async setCancelRequested(
    runId: string,
    reason: string,
  ): Promise<ResultValue<void, AutomationRunSubAgentError>> {
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(schema.automationRun)
          .set({
            cancelRequestedAt: new Date(),
            error: reason,
            updatedAt: new Date(),
          })
          .where(eq(schema.automationRun.id, runId))
      },
      catch: (cause) => dbError('request automation run cancellation', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok()
  }

  private async cancelRunIfRequested(
    runId: string,
  ): Promise<ResultValue<boolean, AutomationRunSubAgentError>> {
    const [run] = await this.getDb()
      .select()
      .from(schema.automationRun)
      .where(eq(schema.automationRun.id, runId))
      .limit(1)
    if (!run?.cancelRequestedAt) return Result.ok(false)
    const cancelResult = await this.finishCancelled(runId, 'cancelled')
    if (cancelResult.isErr()) return Result.err(cancelResult.error)
    return Result.ok(true)
  }

  private async finishCompleted(
    runId: string,
    completion: {
      output: string
      data: unknown
      source: 'assistant' | 'complete_automation'
    },
  ): Promise<ResultValue<void, AutomationRunSubAgentError>> {
    const db = this.getDb()
    const now = new Date()
    const output = completion.output.trim()
    if (!output) {
      return Result.err(
        new AutomationRunSubAgentError({
          code: 'invalid_state',
          message: 'Automation completion requires non-empty output.',
        }),
      )
    }
    const result = await Result.tryPromise({
      try: async () => {
        await db.transaction(async (tx) => {
          const [automationRun] = await tx
            .select({
              automationId: schema.automationRun.automationId,
              status: schema.automationRun.status,
            })
            .from(schema.automationRun)
            .where(eq(schema.automationRun.id, runId))
            .limit(1)
          if (
            !automationRun ||
            isTerminalAutomationRunStatus(automationRun.status)
          ) {
            return
          }

          await tx
            .update(schema.automationRun)
            .set({
              status: 'completed',
              resultJson: {
                resolution: 'automation_completed',
                output,
                data: completion.data,
                source: completion.source,
              },
              completedAt: now,
              failureReason: null,
              error: null,
              updatedAt: now,
            })
            .where(eq(schema.automationRun.id, runId))
          await tx
            .update(schema.automation)
            .set({
              lastRunAt: now,
              updatedAt: now,
              runCount: sql`${schema.automation.runCount} + 1`,
              successCount: sql`${schema.automation.successCount} + 1`,
            })
            .where(eq(schema.automation.id, automationRun.automationId))
        })
      },
      catch: (cause) => dbError('finish automation run', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok()
  }

  private async finishCancelled(
    runId: string,
    reason: string,
  ): Promise<ResultValue<void, AutomationRunSubAgentError>> {
    const db = this.getDb()
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () => {
        await db.transaction(async (tx) => {
          const [automationRun] = await tx
            .select({
              automationId: schema.automationRun.automationId,
              status: schema.automationRun.status,
            })
            .from(schema.automationRun)
            .where(eq(schema.automationRun.id, runId))
            .limit(1)
          if (
            !automationRun ||
            isTerminalAutomationRunStatus(automationRun.status)
          ) {
            return
          }

          await tx
            .update(schema.automationRun)
            .set({
              status: 'cancelled',
              error: reason,
              resultJson: { resolution: 'cancelled', reason },
              completedAt: now,
              failureReason: reason,
              updatedAt: now,
            })
            .where(eq(schema.automationRun.id, runId))
          await tx
            .update(schema.automation)
            .set({
              lastRunAt: now,
              updatedAt: now,
              runCount: sql`${schema.automation.runCount} + 1`,
            })
            .where(eq(schema.automation.id, automationRun.automationId))
        })
      },
      catch: (cause) => dbError('cancel automation run', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok()
  }

  private async forceCloseFailed(
    runId: string,
    reason: string,
  ): Promise<ResultValue<void, AutomationRunSubAgentError>> {
    const db = this.getDb()
    const now = new Date()
    const writeResult = await Result.tryPromise({
      try: async () => {
        await db.transaction(async (tx) => {
          const [automationRun] = await tx
            .select({
              automationId: schema.automationRun.automationId,
              status: schema.automationRun.status,
            })
            .from(schema.automationRun)
            .where(eq(schema.automationRun.id, runId))
            .limit(1)
          if (
            !automationRun ||
            isTerminalAutomationRunStatus(automationRun.status)
          ) {
            return
          }

          await tx
            .update(schema.automationRun)
            .set({
              status: 'failed',
              error: reason,
              resultJson: { resolution: 'failed', reason },
              completedAt: now,
              failureReason: reason,
              updatedAt: now,
            })
            .where(eq(schema.automationRun.id, runId))
          await tx
            .update(schema.automation)
            .set({
              lastRunAt: now,
              updatedAt: now,
              runCount: sql`${schema.automation.runCount} + 1`,
              failureCount: sql`${schema.automation.failureCount} + 1`,
            })
            .where(eq(schema.automation.id, automationRun.automationId))
        })
      },
      catch: (cause) => dbError('force close failed automation run', cause),
    })
    if (writeResult.isErr()) return Result.err(writeResult.error)
    return Result.ok()
  }

  private clearTurnState() {
    this.currentRunId = null
    this.currentPermissions = null
    this.aggUsage = null
  }

  private getMcpController() {
    const host: McpHost = {
      name: this.name,
      env: this.env,
      ctx: this.ctx,
      mcp: this.mcp,
      getServerStates: () =>
        this.getMcpServers().servers as RuntimeMcpServerStates,
      connectRpcMcpServer: async ({ connectorId, props }) =>
        await connectRpcMcpConnector({
          mcp: this.mcp,
          namespace: this.env.MCP_SESSION,
          connectorId,
          props,
        }),
      removeMcpServer: this.removeMcpServer.bind(this),
      resolveRuntimeIdentity: async () =>
        await this.resolveAutomationMcpIdentity(),
    }
    return new RuntimeMcpController(host)
  }

  private async resolveAutomationMcpIdentity(): Promise<
    ResultValue<ThreadRuntimeIdentity, RuntimeMcpError>
  > {
    const runId = this.currentRunId
    if (!runId) {
      return Result.err(
        new RuntimeMcpError({
          code: 'thread_not_found',
          message: 'Automation MCP identity requested outside an active run.',
        }),
      )
    }

    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await this.getDb()
          .select({
            workspaceId: schema.automationRun.workspaceId,
            userId: schema.agent.ownerUserId,
            agentId: schema.automationRun.agentId,
          })
          .from(schema.automationRun)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.automationRun.agentId),
          )
          .where(eq(schema.automationRun.id, runId))
          .limit(1)
        return row ?? null
      },
      catch: (cause) => cause,
    })
    if (result.isErr()) {
      return Result.err(
        new RuntimeMcpError({
          code: 'database_failed',
          message:
            result.error instanceof Error
              ? result.error.message
              : 'Failed to load automation MCP identity.',
        }),
      )
    }
    if (!result.value) {
      return Result.err(
        new RuntimeMcpError({
          code: 'thread_not_found',
          message: 'Automation run not found for MCP identity.',
        }),
      )
    }

    return Result.ok({
      threadId: this.name,
      workspaceId: result.value.workspaceId,
      userId: result.value.userId,
      agentId: result.value.agentId,
      runId,
    })
  }

  private async ensureProxyMcpConnectionsForTurn() {
    return await this.mcpConnectionPreparer.ensureForTurn('automation-turn')
  }
}
