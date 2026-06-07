import {
  Session,
  Think,
  type ChatResponseResult,
  type StepContext,
  type SubmitMessagesResult,
  type ThinkSubmissionInspection,
  type ToolCallContext,
  type ToolCallResultContext,
  type TurnConfig,
  type TurnContext,
} from '@cloudflare/think'
import { Workspace } from '@cloudflare/shell'
import type { Connection } from 'agents'
import type { McpAgent } from 'agents/mcp'
import { getSandbox, type Sandbox as SandboxDO } from '@cloudflare/sandbox'
import {
  hasToolCall,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
} from 'ai'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { classifyConnectorError } from '@garden/core/connectors/errors'
import { createGardenLogger } from '@garden/core/observability/logger'
import {
  derivePermissions,
  type AgentPermissions,
} from '@garden/core/agents/permissions'
import { formatIssueIdentifier } from '@garden/core/issues/identifier'
import {
  isLiveIssueRunStatus,
  nextIssueStatusForRunStatus,
} from '@garden/core/issues/run-sync'
import type { IssueStatus } from '@garden/core/types/issue'
import type {
  IssueRunStatus,
  IssueRunUsage,
} from '@garden/core/types/issue-run'
import { connectorRegistry } from '@garden/connectors'
import * as schema from '@garden/db/schema'
import issueInteractionSkillMarkdown from './skills/issue-interaction/SKILL.md?raw'
import { createAskQuestionTool } from './agent-tools/ask-question'
import { createAttachSourceBindingTool } from './agent-tools/attach-source-binding'
import { createCreateChildIssueTool } from './agent-tools/create-child-issue'
import { createCreateWorkProductTool } from './agent-tools/create-work-product'
import {
  IssueRunToolError,
  appendIssueRunEvent,
  getIssueRunDb,
  updateRunStatus,
  type IssueRunResolutionAction,
  type IssueRunToolContext,
  type IssueRunToolState,
} from './agent-tools/issue-run-tool-context'
import { createMarkBlockedTool } from './agent-tools/mark-blocked'
import { createPostCommentTool } from './agent-tools/post-comment'
import { createReadSourceTool } from './agent-tools/read-source'
import { createReviseWorkProductTool } from './agent-tools/revise-work-product'
import { createUpdateIssueStatusTool } from './agent-tools/update-issue-status'
import {
  createUpdatePlanTool,
  readIssueRunPlan,
} from './agent-tools/update-plan'
import { assembleFoundationPrompt } from './prompt'
import { createAgentModel } from './model'
import {
  RuntimeMcpConnectionPreparer,
  RuntimeMcpError,
  RuntimeMcpController,
  type McpHost,
  type RuntimeMcpServerStates,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'
import { mcpRuntimeConfig } from './mcp-runtime-config'
import { createChatSubAgentTools } from './chat-sub-agent-tools'
import { addStepUsage, normalizeRunUsage } from './run-usage'
import {
  getRunWorkflowTurnCompleteEventType,
  type RunWorkflowBinding,
  type RunWorkflowTurnCompleteEvent,
  type RunWorkflowTurnStartResult,
} from './run-workflow'
import { logAgentSocketError } from './websocket-errors'

type AgentRuntimeEnv = Cloudflare.Env & {
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  DATABASE_URL: string
  AI: Ai
  AI_GATEWAY_ID?: string
  FILES: R2Bucket
  LOADER: WorkerLoader
  Sandbox: DurableObjectNamespace<SandboxDO>
  MCP_SESSION: DurableObjectNamespace
  RUN_WORKFLOW: RunWorkflowBinding
}

type TurnMode = 'start' | 'resume'

type StartTurnInput = {
  runId: string
  issueId: string
  turn: number
}

const TERMINAL_SUBMISSION_STATUSES = new Set([
  'completed',
  'aborted',
  'skipped',
  'error',
])

function isTerminalSubmissionStatus(status: string) {
  return TERMINAL_SUBMISSION_STATUSES.has(status)
}

type LoadedTurnContext = {
  contextBlock: string
  issue: typeof schema.issue.$inferSelect
  permissions: AgentPermissions
  run: typeof schema.issueRun.$inferSelect
  runState: IssueRunToolState
}

type ResolutionGuardRow = {
  run_id: string
  nudge_count: number
  updated_at: string
}

const DEFAULT_ISSUE_RUN_TIMEOUT_SEC = 2 * 60 * 60
const THINK_TURN_MAX_RETRIES = 1
const THINK_TURN_TELEMETRY_FUNCTION_ID = 'garden.issue-run.turn'
const issueRunLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'issue-run-sub-agent',
})

const VALID_RESOLUTION_ACTIONS = new Set<IssueRunResolutionAction>([
  'ask_question',
  'create_work_product',
  'revise_work_product',
  'mark_blocked',
  'create_child_issue',
])

const TERMINAL_RESOLUTION_ACTIONS = new Set<IssueRunResolutionAction>([
  'ask_question',
  'create_work_product',
  'revise_work_product',
  'mark_blocked',
])

const ISSUE_RUN_TERMINAL_TOOL_STOP_CONDITIONS = [
  hasToolCall('ask_question'),
  hasToolCall('create_work_product'),
  hasToolCall('revise_work_product'),
  hasToolCall('mark_blocked'),
  hasToolCall('create_child_issue'),
]

let cachedIssueInteractionSkillMarkdown: string | null = null

class IssueRunSubAgentError extends TaggedError('IssueRunSubAgentError')<{
  code: 'database_failed' | 'invalid_state' | 'not_found' | 'runtime_failed'
  message: string
  cause?: unknown
}>() {}

class IssueRunTurnStopped extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IssueRunTurnStopped'
  }
}

function dbError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new IssueRunSubAgentError({
    code: 'database_failed',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

function dateToIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

function objectOrNull(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function issueIdentifier(number: number, prefix: string = 'ISS') {
  // Falls back to 'ISS' when the workspace prefix isn't loaded into the
  // turn context yet. Prompt-display only — real routing uses the UUID.
  return formatIssueIdentifier(prefix, number)
}

function stripSkillFrontmatter(markdown: string) {
  if (!markdown.startsWith('---\n')) return markdown.trim()
  const end = markdown.indexOf('\n---', 4)
  return end >= 0 ? markdown.slice(end + 4).trim() : markdown.trim()
}

async function loadIssueInteractionSkillMarkdown() {
  if (cachedIssueInteractionSkillMarkdown) {
    return cachedIssueInteractionSkillMarkdown
  }

  cachedIssueInteractionSkillMarkdown = stripSkillFrontmatter(
    issueInteractionSkillMarkdown,
  )
  return cachedIssueInteractionSkillMarkdown
}

function renderJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function renderSection(title: string, body: string) {
  return [`## ${title}`, body.trim() || 'None.'].join('\n')
}

function isActiveRunStatus(status: string) {
  return isLiveIssueRunStatus(status as IssueRunStatus)
}

export class IssueRunSubAgent extends Think<AgentRuntimeEnv> {
  /**
   * Handles issue-run websocket disconnects as expected lifecycle churn while
   * preserving non-connection runtime failures as errors. This prevents deploy
   * or client network closes from polluting observability as app exceptions.
   */
  override onError(connection: Connection, error: unknown): void
  override onError(error: unknown): void
  override onError(connectionOrError: Connection | unknown, error?: unknown) {
    logAgentSocketError({
      logger: issueRunLogger,
      component: 'issue-run-sub-agent',
      connection: error === undefined ? null : (connectionOrError as Connection),
      error: error ?? connectionOrError,
    })
  }

  constructor(ctx: DurableObjectState, env: AgentRuntimeEnv) {
    super(ctx, env)
  }

  override chatRecovery = true

  waitForMcpConnections = {
    timeout: mcpRuntimeConfig.connectionWaitTimeoutMs,
  }
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.FILES,
    name: () => this.name,
  })
  private currentRunState: IssueRunToolState | null = null
  private currentRunId: string | null = null
  private currentTriggerReason = ''
  private resolutionActions = new Set<IssueRunResolutionAction>()
  private currentPermissions: AgentPermissions | null = null
  private aggUsage: IssueRunUsage | null = null
  private readonly mcpConnectionPreparer = new RuntimeMcpConnectionPreparer({
    getController: () => this.getMcpController(),
    fullSyncIntervalMs: mcpRuntimeConfig.connectorFullSyncIntervalMs,
    waitForConnections: async (timeoutMs) =>
      await this.mcp.waitForConnections({ timeout: timeoutMs }),
    getServerStates: () =>
      this.getMcpServers().servers as RuntimeMcpServerStates,
    connectionWaitTimeoutMs: mcpRuntimeConfig.connectionWaitTimeoutMs,
    backgroundRefreshFailedMessage:
      '[agent-runtime] issue MCP background refresh failed',
    refreshFailedMessage: '[agent-runtime] issue MCP connector refresh failed',
    continuingWithoutReadyMessage:
      '[agent-runtime] issue MCP connectors are not ready',
    readinessPolicy: 'required',
  })

  maxSteps = 30

  getModel(): LanguageModel {
    return createAgentModel({
      ai: this.env.AI,
      gatewayId: this.env.AI_GATEWAY_ID,
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
      .withContext('issue-interaction', {
        description:
          'Required issue-run behavior, tool rules, exit states, and output discipline.',
        provider: {
          get: async () => await loadIssueInteractionSkillMarkdown(),
        },
      })
      .withCachedPrompt()
  }

  override async onStart() {
    await loadIssueInteractionSkillMarkdown()
  }

  override getTools(): ToolSet {
    const context = this.getIssueToolContext()
    return {
      ...createChatSubAgentTools({
        databaseUrl: this.env.DATABASE_URL,
        threadId: this.name,
        workspace: this.workspace,
        loader: this.env.LOADER,
        getSandbox: () => this.getAgentSandbox(),
        issueRunEnv: this.env,
      }),
      update_plan: createUpdatePlanTool(context),
      post_comment: createPostCommentTool(context),
      ask_question: createAskQuestionTool(context),
      create_work_product: createCreateWorkProductTool(context),
      revise_work_product: createReviseWorkProductTool(context),
      update_issue_status: createUpdateIssueStatusTool(context),
      mark_blocked: createMarkBlockedTool(context),
      create_child_issue: createCreateChildIssueTool(context),
      attach_source_binding: createAttachSourceBindingTool(context),
      read_source: createReadSourceTool(context),
    }
  }

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig | void> {
    const runId = this.currentRunId ?? stringValue(ctx.body?.run_id)
    if (!runId) {
      throw new Error('IssueRunSubAgent.beforeTurn missing run_id.')
    }

    const loadedResult = await this.loadTurnContext(runId)
    if (loadedResult.isErr()) throw loadedResult.error

    const guardResult = await this.applyRunBoundaryGuards(loadedResult.value)
    if (guardResult.isErr()) throw guardResult.error
    if (guardResult.value !== 'continue') {
      throw new IssueRunTurnStopped(guardResult.value)
    }

    this.currentRunId = runId
    this.currentRunState = loadedResult.value.runState
    this.currentPermissions = loadedResult.value.permissions
    this.resolutionActions.clear()
    this.aggUsage = null
    issueRunLogger.info('issue_run.turn.started', {
      userId: loadedResult.value.runState.agentOwnerUserId,
      workspaceId: loadedResult.value.runState.workspaceId,
      agentId: loadedResult.value.runState.agentId,
      issueId: loadedResult.value.runState.issueId,
      runId,
    })

    const mcpController = await this.ensureProxyMcpConnectionsForTurn()
    const observedChangesResult = mcpController.captureObservedMcpToolChanges()
    if (observedChangesResult.isErr()) {
      console.warn(
        '[agent-runtime] failed to capture MCP tool changes for issue run',
        observedChangesResult.error,
      )
    }

    const stableMcpTools = mcpController.wrapGetAITools(
      this.mcp.getAITools.bind(this.mcp),
      undefined,
      {
        shouldAutoApprove: ({ riskClass }) =>
          this.shouldAutoApproveRiskClass(riskClass),
      },
    )

    return {
      experimental_telemetry: {
        functionId: THINK_TURN_TELEMETRY_FUNCTION_ID,
        isEnabled: true,
        metadata: {
          agentClass: 'IssueRunSubAgent',
          issueId: this.name,
          runId,
        },
        recordInputs: false,
        recordOutputs: false,
      },
      maxRetries: THINK_TURN_MAX_RETRIES,
      maxSteps: this.maxSteps,
      sendReasoning: true,
      stopWhen: ISSUE_RUN_TERMINAL_TOOL_STOP_CONDITIONS,
      system: `${ctx.system}\n\n${loadedResult.value.contextBlock}`,
      tools: stableMcpTools,
      activeTools: mcpController.activeToolKeysWithoutRawMcp({
        assembledTools: ctx.tools,
        stableMcpTools,
      }),
    } satisfies TurnConfig
  }

  override async beforeToolCall(ctx: ToolCallContext) {
    const run = this.currentRunState
    if (!run) return undefined

    if (this.hasTerminalResolutionAction()) {
      return {
        action: 'substitute',
        output: {
          ok: true,
          skipped: true,
          reason:
            'A resolution action already completed this issue run. No further tool calls are needed.',
        },
      } as const
    }

    const activeResult = await this.assertRunActiveForTool(run.runId)
    if (activeResult.isErr()) throw activeResult.error

    const gateResult = this.assertToolAllowed(ctx.toolName)
    if (gateResult.isErr()) throw gateResult.error

    issueRunLogger.info('issue_run.tool.started', {
      userId: run.agentOwnerUserId,
      workspaceId: run.workspaceId,
      agentId: run.agentId,
      issueId: run.issueId,
      runId: run.runId,
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
      step: ctx.stepNumber,
    })

    const db = getIssueRunDb(this.env.DATABASE_URL)
    const eventResult = await appendIssueRunEvent({
      db,
      run,
      eventType: 'issue_run:tool_started',
      stream: 'tool',
      message: `Started ${ctx.toolName}`,
      payload: {
        tool: ctx.toolName,
        tool_call_id: ctx.toolCallId,
        input: ctx.input as Record<string, unknown>,
      },
    })
    if (eventResult.isErr()) {
      console.warn('[agent-runtime] failed to append tool start event', {
        error: eventResult.error.message,
        runId: run.runId,
        tool: ctx.toolName,
      })
    }

    return undefined
  }

  override async afterToolCall(ctx: ToolCallResultContext) {
    const run = this.currentRunState
    if (!run) return

    const output = ctx.success ? objectOrNull(ctx.output) : null
    const ok = ctx.success && output?.ok !== false
    issueRunLogger[ok ? 'info' : 'warn']('issue_run.tool.finished', {
      userId: run.agentOwnerUserId,
      workspaceId: run.workspaceId,
      agentId: run.agentId,
      issueId: run.issueId,
      runId: run.runId,
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
      durationMs: ctx.durationMs,
      ok,
    })
    const db = getIssueRunDb(this.env.DATABASE_URL)
    const eventResult = await appendIssueRunEvent({
      db,
      run,
      eventType: 'issue_run:tool_finished',
      stream: 'tool',
      level: ok ? 'info' : 'error',
      message: `${ctx.toolName} ${ok ? 'finished' : 'failed'}`,
      payload: {
        tool: ctx.toolName,
        tool_call_id: ctx.toolCallId,
        ok,
        duration_ms: ctx.durationMs,
        error: ctx.success
          ? stringValue(output?.error)
          : ctx.error instanceof Error
            ? ctx.error.message
            : String(ctx.error),
        error_class: ctx.success ? (output?.error_class ?? null) : null,
      },
    })
    if (eventResult.isErr()) {
      console.warn('[agent-runtime] failed to append tool finish event', {
        error: eventResult.error.message,
        runId: run.runId,
        tool: ctx.toolName,
      })
    }
  }

  /**
   * Wakes the owning RunWorkflow when Think records a terminal submission.
   * This is the event-driven bridge that replaces DO-local waiters/timeouts
   * while keeping Think as the durable turn ledger.
   */
  override async onSubmissionStatus(submission: ThinkSubmissionInspection) {
    if (!isTerminalSubmissionStatus(submission.status)) return
    const runId =
      typeof submission.metadata?.runId === 'string'
        ? submission.metadata.runId
        : null
    if (!runId) return

    const payload: RunWorkflowTurnCompleteEvent = {
      submissionId: submission.submissionId,
      status: submission.status,
      ...(submission.error ? { error: submission.error } : {}),
    }
    const sendResult = await Result.tryPromise({
      try: async () => {
        const instance = await this.env.RUN_WORKFLOW.get(runId)
        await instance.sendEvent({
          type: getRunWorkflowTurnCompleteEventType(submission.submissionId),
          payload,
        })
      },
      catch: (cause) => cause,
    })
    if (sendResult.isErr()) {
      console.warn('[agent-runtime] failed to notify issue workflow turn', {
        error:
          sendResult.error instanceof Error
            ? sendResult.error.message
            : String(sendResult.error),
        runId,
        submissionId: submission.submissionId,
      })
    }
  }

  override async onStepFinish(ctx: StepContext) {
    const runId = this.currentRunId
    if (!runId) return

    const nextUsage = addStepUsage(this.aggUsage, ctx)
    this.aggUsage = nextUsage

    const persistResult = await this.persistUsage(runId, nextUsage)
    if (persistResult.isErr()) {
      console.warn('[agent-runtime] failed to persist issue run usage', {
        error: persistResult.error.message,
        runId,
      })
    }
  }

  override async onChatResponse(result: ChatResponseResult) {
    const runId = this.currentRunId
    if (!runId) return

    const run = this.currentRunState
    if (run) {
      issueRunLogger.info('issue_run.turn.finished', {
        userId: run.agentOwnerUserId,
        workspaceId: run.workspaceId,
        agentId: run.agentId,
        issueId: run.issueId,
        runId,
        status: result.status,
      })
    }

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
        console.warn('[agent-runtime] failed to apply issue run cancellation', {
          error: cancelResult.error.message,
          runId,
        })
      } else if (!cancelResult.value) {
        const failedResult = await this.forceCloseFailed(runId, 'turn_aborted')
        if (failedResult.isErr()) {
          console.warn('[agent-runtime] failed to close aborted issue run', {
            error: failedResult.error.message,
            runId,
          })
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
        console.warn('[agent-runtime] failed to close errored issue run', {
          error: failedResult.error.message,
          runId,
        })
      }
      this.clearTurnState()
      return
    }

    const guardResult = await this.enforceResolutionGuard(runId)
    if (guardResult.isErr()) {
      console.warn('[agent-runtime] issue run exit guard failed', {
        error: guardResult.error.message,
        runId,
      })
    }

    const finalizeChildResult = await this.finalizeChildIssueResolution(runId)
    if (finalizeChildResult.isErr()) {
      console.warn(
        '[agent-runtime] issue run child resolution finalize failed',
        {
          error: finalizeChildResult.error.message,
          runId,
        },
      )
    }

    this.clearTurnState()
  }

  /**
   * Reads the live plan from the issue-run facet's SQLite state for debug/UI
   * RPCs. This stays facet-local because plan tool updates are written during
   * Think turns before the product DB is finalized.
   */
  getRunPlan(runId: string): Array<{
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    activeForm: string
  }> | null {
    return readIssueRunPlan(this.ctx.storage.sql, runId)
  }

  /**
   * Submits one idempotent Think turn for RunWorkflow and returns as soon as the
   * SDK ledger accepts it. The previous implementation waited inside the DO
   * with an arbitrary timer; Workflow now does the durable wait via the terminal
   * submission event emitted from `onSubmissionStatus`.
   */
  async executeWorkflowTurn(
    mode: TurnMode,
    input: StartTurnInput,
  ): Promise<RunWorkflowTurnStartResult> {
    const [runRow] = await this.getDb()
      .select({
        cancelRequestedAt: schema.issueRun.cancelRequestedAt,
        status: schema.issueRun.status,
      })
      .from(schema.issueRun)
      .where(eq(schema.issueRun.id, input.runId))
      .limit(1)

    if (runRow?.cancelRequestedAt) {
      const runStateResult = await this.loadRunState(input.runId)
      if (runStateResult.isErr()) {
        await this.forceCloseFailed(input.runId, runStateResult.error.message)
        throw new Error(runStateResult.error.message)
      }
      const cancelResult = await this.finishCancelled(
        runStateResult.value,
        'cancelled',
      )
      if (cancelResult.isErr()) {
        await this.forceCloseFailed(input.runId, cancelResult.error.message)
        throw new Error(cancelResult.error.message)
      }
      return { kind: 'run_status', status: 'cancelled' }
    }

    const driveResult = await this.driveTurn(mode, input)
    if (driveResult.isErr()) {
      await this.forceCloseFailed(input.runId, driveResult.error.message)
      throw new Error(driveResult.error.message)
    }
    if (driveResult.value.kind === 'stopped') {
      const statusResult = await this.readRunStatus(input.runId)
      if (statusResult.isErr()) {
        await this.forceCloseFailed(input.runId, statusResult.error.message)
        throw new Error(statusResult.error.message)
      }
      return { kind: 'run_status', status: statusResult.value }
    }

    return {
      kind: 'submitted',
      submissionId: driveResult.value.submissionId,
      submissionStatus: driveResult.value.status,
    }
  }

  /**
   * Converts a terminal Think submission into Garden's product run status after
   * Workflow receives the durable event. This preserves Garden's cancellation,
   * skipped-turn, and failure bookkeeping without making the DO own the wait.
   */
  async completeWorkflowTurn(input: {
    runId: string
    submissionId: string
  }): Promise<{ status: string }> {
    const inspectionResult = await Result.tryPromise({
      try: async () => await this.inspectSubmission(input.submissionId),
      catch: (cause) => cause,
    })
    if (inspectionResult.isErr()) {
      await this.forceCloseFailed(input.runId, String(inspectionResult.error))
      throw new Error(
        inspectionResult.error instanceof Error
          ? inspectionResult.error.message
          : String(inspectionResult.error),
      )
    }

    const inspection = inspectionResult.value
    if (!inspection) {
      const message = `Submitted issue turn ${input.submissionId} was not found.`
      await this.forceCloseFailed(input.runId, message)
      throw new Error(message)
    }
    if (!isTerminalSubmissionStatus(inspection.status)) {
      throw new Error(
        `Submitted issue turn ${input.submissionId} is still ${inspection.status}.`,
      )
    }

    if (inspection.status === 'error') {
      const failedResult = await this.forceCloseFailed(
        input.runId,
        inspection.error ?? 'Submitted issue turn failed.',
      )
      if (failedResult.isErr()) throw new Error(failedResult.error.message)
      this.clearTurnState()
    }
    if (inspection.status === 'aborted') {
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
        if (failedResult.isErr()) throw new Error(failedResult.error.message)
      }
      this.clearTurnState()
    }
    if (inspection.status === 'skipped') {
      const failedResult = await this.forceCloseFailed(
        input.runId,
        'turn_skipped',
      )
      if (failedResult.isErr()) throw new Error(failedResult.error.message)
      this.clearTurnState()
    }

    const statusResult = await this.readRunStatus(input.runId)
    if (statusResult.isErr()) {
      await this.forceCloseFailed(input.runId, statusResult.error.message)
      throw new Error(statusResult.error.message)
    }
    return { status: statusResult.value }
  }

  async requestCancel(input: {
    runId: string
    issueId: string
  }): Promise<void> {
    const cancelResult = await this.setCancelRequested(input.runId, 'cancelled')
    if (cancelResult.isErr()) {
      console.warn('[agent-runtime] failed to request issue run cancellation', {
        error: cancelResult.error.message,
        runId: input.runId,
      })
    }
    await this.cancelRunSubmissions(input.runId, 'cancelled')
    this.abortAllRequests()
  }

  /**
   * Cancels accepted-but-not-terminal Think submissions for this run. SDK
   * durable submissions can sit pending before inference starts; aborting only
   * active requests would let those turns wake later after Garden already
   * recorded cancellation.
   */
  private async cancelRunSubmissions(runId: string, reason: string) {
    const submissionsResult = await Result.tryPromise({
      try: async () =>
        await this.listSubmissions({ status: ['pending', 'running'] }),
      catch: (cause) => cause,
    })
    if (submissionsResult.isErr()) {
      console.warn('[agent-runtime] failed to list issue submissions', {
        error:
          submissionsResult.error instanceof Error
            ? submissionsResult.error.message
            : String(submissionsResult.error),
        runId,
      })
      return
    }

    const cancelResult = await Result.tryPromise({
      try: async () =>
        await Promise.all(
          submissionsResult.value
            .filter((submission) => submission.metadata?.runId === runId)
            .map((submission) =>
              this.cancelSubmission(submission.submissionId, reason),
            ),
        ),
      catch: (cause) => cause,
    })
    if (cancelResult.isErr()) {
      console.warn('[agent-runtime] failed to cancel issue submissions', {
        error:
          cancelResult.error instanceof Error
            ? cancelResult.error.message
            : String(cancelResult.error),
        runId,
      })
    }
  }

  private async driveTurn(
    mode: TurnMode,
    input: StartTurnInput,
  ): Promise<
    ResultValue<
      | { kind: 'stopped' }
      | {
          kind: 'submitted'
          status: SubmitMessagesResult['status']
          submissionId: string
        },
      IssueRunSubAgentError
    >
  > {
    const loadedResult = await this.loadTurnContext(input.runId)
    if (loadedResult.isErr()) return Result.err(loadedResult.error)

    const boundaryResult = await this.applyRunBoundaryGuards(loadedResult.value)
    if (boundaryResult.isErr()) return Result.err(boundaryResult.error)
    if (boundaryResult.value !== 'continue') {
      return Result.ok({ kind: 'stopped' })
    }

    if (mode === 'start') {
      const startResult = await this.markRunStarted(loadedResult.value)
      if (startResult.isErr()) return Result.err(startResult.error)
    } else {
      const resumeResult = await this.markRunResumed(loadedResult.value)
      if (resumeResult.isErr()) return Result.err(resumeResult.error)
    }

    this.currentRunId = input.runId
    this.currentRunState = loadedResult.value.runState
    this.currentPermissions = loadedResult.value.permissions

    const submissionId = `issue-run:${input.runId}:${input.turn}:${mode}`
    const message: UIMessage = {
      id: `${submissionId}:user`,
      role: 'user',
      parts: [
        {
          type: 'text',
          text:
            mode === 'resume'
              ? 'Resume this issue run using the latest issue context. If the user answered a pending question, use that answer now.'
              : 'Start this issue run using the injected issue context. Produce a useful work product, ask one focused question, mark blocked, or decompose into child issues.',
        },
      ],
    }

    return await this.submitWorkflowTurn({
      submissionId,
      message,
      metadata: {
        kind: 'issue',
        issueId: input.issueId,
        mode,
        runId: input.runId,
        turn: input.turn,
      },
    })
  }

  /**
   * Submits a durable Think turn and returns immediately to the Workflow.
   * Waiting now lives in `Workflow.waitForEvent()` and completion is reported
   * from `onSubmissionStatus`, so long-running turns are no longer constrained
   * by a DO-local timer or in-memory callback map. References: Cloudflare Think
   * durable submissions and Cloudflare Workflow event docs.
   */
  private async submitWorkflowTurn(args: {
    submissionId: string
    message: UIMessage
    metadata: Record<string, unknown>
  }): Promise<
    ResultValue<
      | { kind: 'stopped' }
      | {
          kind: 'submitted'
          status: SubmitMessagesResult['status']
          submissionId: string
        },
      IssueRunSubAgentError
    >
  > {
    const submitResult = await Result.tryPromise({
      try: async () =>
        await this.submitMessages([args.message], {
          submissionId: args.submissionId,
          idempotencyKey: args.submissionId,
          metadata: args.metadata,
        }),
      catch: (cause) => cause,
    })
    if (submitResult.isErr()) {
      if (submitResult.error instanceof IssueRunTurnStopped) {
        return Result.ok({ kind: 'stopped' })
      }
      return Result.err(this.runtimeFailure(submitResult.error))
    }

    return Result.ok({
      kind: 'submitted',
      submissionId: submitResult.value.submissionId,
      status: submitResult.value.status,
    })
  }

  private runtimeFailure(cause: unknown) {
    return new IssueRunSubAgentError({
      code: 'runtime_failed',
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    })
  }

  private getIssueToolContext(): IssueRunToolContext {
    return {
      env: this.env,
      storageSql: this.ctx.storage.sql,
      getRunState: () => this.currentRunState,
      recordResolution: (action) => {
        if (VALID_RESOLUTION_ACTIONS.has(action)) {
          this.resolutionActions.add(action)
        }
      },
      mcp: {
        ensureConnections: async () => await this.ensureMcpConnectionsForTool(),
        listTools: (filter) => this.mcp.listTools(filter),
        callTool: async (params) => {
          const mcp = this.mcp as unknown as {
            callTool?: (input: typeof params) => Promise<unknown>
          }
          if (!mcp.callTool) {
            throw new Error('MCP callTool is not available.')
          }
          return await mcp.callTool(params)
        },
      },
    }
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
  ): ResultValue<void, IssueRunSubAgentError> {
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
        new IssueRunSubAgentError({
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
        new IssueRunSubAgentError({
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

  private async assertRunActiveForTool(
    runId: string,
  ): Promise<ResultValue<void, IssueRunSubAgentError>> {
    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await this.getDb()
          .select({ status: schema.issueRun.status })
          .from(schema.issueRun)
          .where(eq(schema.issueRun.id, runId))
          .limit(1)
        return row ?? null
      },
      catch: (cause) =>
        dbError('load issue run status before tool call', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    const status = result.value?.status
    if (status && isLiveIssueRunStatus(status as IssueRunStatus)) {
      return Result.ok()
    }

    return Result.err(
      new IssueRunSubAgentError({
        code: 'invalid_state',
        message: `Issue run is no longer active (${status ?? 'missing'}).`,
      }),
    )
  }

  private async readRunStatus(
    runId: string,
  ): Promise<ResultValue<string, IssueRunSubAgentError>> {
    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await this.getDb()
          .select({ status: schema.issueRun.status })
          .from(schema.issueRun)
          .where(eq(schema.issueRun.id, runId))
          .limit(1)
        return row?.status ?? 'unknown'
      },
      catch: (cause) => dbError('load issue run status', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok(result.value)
  }

  private async loadRunState(
    runId: string,
  ): Promise<ResultValue<IssueRunToolState, IssueRunSubAgentError>> {
    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await this.getDb()
          .select({
            runId: schema.issueRun.id,
            workspaceId: schema.issueRun.workspaceId,
            issueId: schema.issueRun.issueId,
            agentId: schema.issueRun.agentId,
            agentOwnerUserId: schema.agent.ownerUserId,
            hostName: schema.issueRun.hostName,
          })
          .from(schema.issueRun)
          .innerJoin(schema.agent, eq(schema.agent.id, schema.issueRun.agentId))
          .where(eq(schema.issueRun.id, runId))
          .limit(1)
        return row ?? null
      },
      catch: (cause) => dbError('load issue run state', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    if (!result.value) {
      return Result.err(
        new IssueRunSubAgentError({
          code: 'not_found',
          message: 'Issue run not found.',
        }),
      )
    }
    return Result.ok(result.value)
  }

  private async loadTurnContext(
    runId: string,
  ): Promise<ResultValue<LoadedTurnContext, IssueRunSubAgentError>> {
    const db = this.getDb()
    const result = await Result.tryPromise({
      try: async () => {
        const [runRow] = await db
          .select({
            run: schema.issueRun,
            issue: schema.issue,
            agent: {
              id: schema.agent.id,
              name: schema.agent.name,
              roleTitle: schema.agent.roleTitle,
              ownerUserId: schema.agent.ownerUserId,
              runTimeoutSec: schema.agent.runTimeoutSec,
              permissions: schema.agent.permissions,
            },
          })
          .from(schema.issueRun)
          .innerJoin(schema.issue, eq(schema.issue.id, schema.issueRun.issueId))
          .innerJoin(schema.agent, eq(schema.agent.id, schema.issueRun.agentId))
          .where(eq(schema.issueRun.id, runId))
          .limit(1)

        if (!runRow) return null

        const [
          comments,
          runs,
          workProducts,
          sourceBindings,
          childIssues,
          availableAgents,
        ] = await Promise.all([
          db
            .select()
            .from(schema.issueComment)
            .where(eq(schema.issueComment.issueId, runRow.issue.id))
            .orderBy(asc(schema.issueComment.createdAt)),
          db
            .select()
            .from(schema.issueRun)
            .where(eq(schema.issueRun.issueId, runRow.issue.id))
            .orderBy(desc(schema.issueRun.createdAt))
            .limit(10),
          db
            .select()
            .from(schema.issueWorkProduct)
            .where(eq(schema.issueWorkProduct.issueId, runRow.issue.id))
            .orderBy(desc(schema.issueWorkProduct.updatedAt)),
          db
            .select()
            .from(schema.issueSourceBinding)
            .where(eq(schema.issueSourceBinding.issueId, runRow.issue.id))
            .orderBy(desc(schema.issueSourceBinding.updatedAt)),
          db
            .select({
              id: schema.issue.id,
              number: schema.issue.number,
              title: schema.issue.title,
              status: schema.issue.status,
              assigneeType: schema.issue.assigneeType,
              assigneeId: schema.issue.assigneeId,
            })
            .from(schema.issue)
            .where(eq(schema.issue.parentId, runRow.issue.id))
            .orderBy(asc(schema.issue.number)),
          db
            .select({
              id: schema.agent.id,
              name: schema.agent.name,
              roleTitle: schema.agent.roleTitle,
            })
            .from(schema.agent)
            .where(
              and(
                eq(schema.agent.workspaceId, runRow.issue.workspaceId),
                inArray(schema.agent.status, ['active', 'pending_approval']),
              ),
            )
            .orderBy(asc(schema.agent.name)),
        ])

        const authorIds = [
          ...new Set(comments.map((comment) => comment.authorId)),
        ]
        const [commentUsers, commentAgents] =
          authorIds.length > 0
            ? await Promise.all([
                db
                  .select({ id: schema.user.id, name: schema.user.name })
                  .from(schema.user)
                  .where(inArray(schema.user.id, authorIds)),
                db
                  .select({ id: schema.agent.id, name: schema.agent.name })
                  .from(schema.agent)
                  .where(inArray(schema.agent.id, authorIds)),
              ])
            : [[], []]

        return {
          runRow,
          comments,
          runs,
          workProducts,
          sourceBindings,
          childIssues,
          availableAgents,
          commentUsers,
          commentAgents,
        }
      },
      catch: (cause) => dbError('load issue turn context', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    if (!result.value) {
      return Result.err(
        new IssueRunSubAgentError({
          code: 'not_found',
          message: 'Issue run not found.',
        }),
      )
    }

    const row = result.value
    const runState: IssueRunToolState = {
      runId: row.runRow.run.id,
      workspaceId: row.runRow.run.workspaceId,
      issueId: row.runRow.run.issueId,
      agentId: row.runRow.run.agentId,
      agentOwnerUserId: row.runRow.agent.ownerUserId,
      hostName: row.runRow.run.hostName,
    }

    const triggerReason = this.renderTriggerReason({
      source:
        row.runRow.run.triggerSource ??
        (row.runRow.run.contextSnapshot as { source?: string } | null)
          ?.source ??
        '',
      contextSnapshot: row.runRow.run.contextSnapshot,
      comments: row.comments,
      users: row.commentUsers,
      agents: row.commentAgents,
    })
    this.currentTriggerReason = triggerReason

    return Result.ok({
      issue: row.runRow.issue,
      permissions: derivePermissions({
        agent: row.runRow.agent,
        issue: row.runRow.issue,
      }),
      run: row.runRow.run,
      runState,
      contextBlock: this.renderContextBlock({
        triggerReason,
        run: row.runRow.run,
        issue: row.runRow.issue,
        agent: row.runRow.agent,
        comments: row.comments,
        runs: row.runs,
        workProducts: row.workProducts,
        sourceBindings: row.sourceBindings,
        childIssues: row.childIssues,
        availableAgents: row.availableAgents,
        users: row.commentUsers,
        agents: row.commentAgents,
      }),
    })
  }

  private renderTriggerReason(input: {
    source: string
    contextSnapshot: unknown
    comments: Array<typeof schema.issueComment.$inferSelect>
    users: Array<{ id: string; name: string | null }>
    agents: Array<{ id: string; name: string }>
  }) {
    const context = objectOrNull(input.contextSnapshot)
    const trigger = objectOrNull(context?.trigger)
    const commentId = stringValue(trigger?.commentId)
    const comment = commentId
      ? input.comments.find((candidate) => candidate.id === commentId)
      : null

    if (input.source === 'assignment') return 'You were assigned this issue.'
    if (input.source === 'manual') return 'A workspace member started this run.'
    if (input.source === 'reconciler_retry') {
      return 'The reconciler retried this issue after a failed or silent run.'
    }
    if (input.source === 'scheduled')
      return 'A scheduled wakeup started this run.'
    if (input.source === 'connector_event') {
      return 'A connector event started this run.'
    }
    if ((input.source === 'comment' || input.source === 'mention') && comment) {
      const authorName = this.authorName({
        authorType: comment.authorType,
        authorId: comment.authorId,
        users: input.users,
        agents: input.agents,
      })
      const body =
        comment.body.length > 500
          ? `${comment.body.slice(0, 500).trimEnd()}...`
          : comment.body
      return input.source === 'mention'
        ? `${authorName} mentioned you in a comment: "${body}"`
        : `${authorName} replied: "${body}"`
    }

    return `This run was triggered by ${input.source}.`
  }

  private renderContextBlock(input: {
    triggerReason: string
    run: typeof schema.issueRun.$inferSelect
    issue: typeof schema.issue.$inferSelect
    agent: {
      id: string
      name: string
      roleTitle: string | null
      ownerUserId: string
      runTimeoutSec: number
      permissions?: unknown
    }
    comments: Array<typeof schema.issueComment.$inferSelect>
    runs: Array<typeof schema.issueRun.$inferSelect>
    workProducts: Array<typeof schema.issueWorkProduct.$inferSelect>
    sourceBindings: Array<typeof schema.issueSourceBinding.$inferSelect>
    childIssues: Array<{
      id: string
      number: number
      title: string
      status: string | null
      assigneeType: string | null
      assigneeId: string | null
    }>
    availableAgents: Array<{
      id: string
      name: string
      roleTitle: string | null
    }>
    users: Array<{ id: string; name: string | null }>
    agents: Array<{ id: string; name: string }>
  }) {
    const previousPlan = readIssueRunPlan(this.ctx.storage.sql, input.run.id)
    const currentAgentName = input.agent.name
    const issue = {
      id: input.issue.id,
      identifier: issueIdentifier(input.issue.number),
      title: input.issue.title,
      description: input.issue.description ?? '',
      status: input.issue.status ?? 'backlog',
      priority: input.issue.priority ?? 'medium',
      assignee:
        input.issue.assigneeType === 'agent'
          ? currentAgentName
          : input.issue.assigneeType === 'user'
            ? input.issue.assigneeId
            : null,
    }

    const comments = input.comments.map((comment) => ({
      id: comment.id,
      author: this.authorName({
        authorType: comment.authorType,
        authorId: comment.authorId,
        users: input.users,
        agents: input.agents,
      }),
      body: comment.body,
      created_at: dateToIso(comment.createdAt),
    }))

    const priorRuns = input.runs.map((run) => ({
      id: run.id,
      status: run.status,
      error: run.error ?? null,
      result_json: objectOrNull(run.resultJson),
      started_at: dateToIso(run.startedAt),
      finished_at: dateToIso(run.finishedAt),
      created_at: dateToIso(run.createdAt),
    }))

    const workProducts = input.workProducts.map((workProduct) => ({
      id: workProduct.id,
      run_id: workProduct.runId,
      type: workProduct.type,
      title: workProduct.title,
      status: workProduct.status,
      review_state: workProduct.reviewState,
      body: workProduct.body ?? '',
      updated_at: dateToIso(workProduct.updatedAt),
    }))

    const sourceBindings = input.sourceBindings.map((binding) => ({
      id: binding.id,
      connector_id: binding.connectorId,
      source_kind: binding.sourceKind,
      external_id: binding.externalId,
      external_url: binding.externalUrl ?? null,
      display_ref: binding.displayRef ?? null,
      title_snapshot: binding.titleSnapshot ?? null,
    }))

    const children = input.childIssues.map((child) => ({
      id: child.id,
      identifier: issueIdentifier(child.number),
      title: child.title,
      status: child.status ?? 'backlog',
      assignee_type: child.assigneeType,
      assignee_id: child.assigneeId,
    }))

    const availableAgents = input.availableAgents.map((agent) => ({
      name: agent.name,
      role: agent.roleTitle ?? 'Workspace agent',
    }))

    return [
      '# Per-run issue context',
      '',
      input.triggerReason,
      '',
      renderSection(
        'Current run',
        renderJson({
          id: input.run.id,
          status: input.run.status,
          started_at: dateToIso(input.run.startedAt),
          cancel_requested_at: dateToIso(input.run.cancelRequestedAt),
          trigger_source: input.run.triggerSource,
          run_timeout_sec: input.agent.runTimeoutSec,
        }),
      ),
      renderSection('Issue', renderJson(issue)),
      renderSection('Comments', renderJson(comments)),
      renderSection('Prior runs', renderJson(priorRuns)),
      renderSection('Work products', renderJson(workProducts)),
      renderSection('Previous live plan', renderJson(previousPlan ?? [])),
      renderSection('Source bindings', renderJson(sourceBindings)),
      renderSection('Child issues', renderJson(children)),
      renderSection('Available agents', renderJson(availableAgents)),
    ].join('\n\n')
  }

  private authorName(input: {
    authorType: string
    authorId: string
    users: Array<{ id: string; name: string | null }>
    agents: Array<{ id: string; name: string }>
  }) {
    if (input.authorType === 'agent') {
      return (
        input.agents.find((agent) => agent.id === input.authorId)?.name ??
        `Agent ${input.authorId}`
      )
    }
    return (
      input.users.find((user) => user.id === input.authorId)?.name ??
      `Member ${input.authorId}`
    )
  }

  private async applyRunBoundaryGuards(
    loaded: LoadedTurnContext,
  ): Promise<
    ResultValue<'continue' | 'cancelled' | 'timeout', IssueRunSubAgentError>
  > {
    if (!isActiveRunStatus(loaded.run.status)) return Result.ok('cancelled')

    if (loaded.run.cancelRequestedAt) {
      const cancelResult = await this.finishCancelled(
        loaded.runState,
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
  ): Promise<ResultValue<number, IssueRunSubAgentError>> {
    const result = await Result.tryPromise({
      try: async () => {
        const [agent] = await this.getDb()
          .select({ runTimeoutSec: schema.agent.runTimeoutSec })
          .from(schema.agent)
          .where(eq(schema.agent.id, agentId))
          .limit(1)
        return Math.max(
          agent?.runTimeoutSec ?? DEFAULT_ISSUE_RUN_TIMEOUT_SEC,
          DEFAULT_ISSUE_RUN_TIMEOUT_SEC,
        )
      },
      catch: (cause) => dbError('load agent run timeout', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok(result.value)
  }

  private async markRunStarted(
    loaded: LoadedTurnContext,
  ): Promise<ResultValue<void, IssueRunSubAgentError>> {
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb().transaction(async (tx) => {
          await tx
            .update(schema.issueRun)
            .set({
              status: 'running',
              startedAt: loaded.run.startedAt ?? now,
              updatedAt: now,
            })
            .where(eq(schema.issueRun.id, loaded.run.id))
          await tx
            .update(schema.issue)
            .set({
              status:
                nextIssueStatusForRunStatus(
                  'running',
                  (loaded.issue.status ?? 'backlog') as IssueStatus,
                ) ?? loaded.issue.status,
              updatedAt: now,
            })
            .where(eq(schema.issue.id, loaded.runState.issueId))
        })
      },
      catch: (cause) => dbError('mark issue run started', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    const db = getIssueRunDb(this.env.DATABASE_URL)
    const eventResult = await appendIssueRunEvent({
      db,
      run: loaded.runState,
      eventType: 'issue_run:started',
      stream: 'system',
      message: 'Run started',
      payload: { issue_id: loaded.runState.issueId },
    })
    if (eventResult.isErr()) {
      return Result.err(
        new IssueRunSubAgentError({
          code: 'database_failed',
          message: eventResult.error.message,
          cause: eventResult.error,
        }),
      )
    }

    return Result.ok()
  }

  private async markRunResumed(
    loaded: LoadedTurnContext,
  ): Promise<ResultValue<void, IssueRunSubAgentError>> {
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(schema.issueRun)
          .set({ status: 'running', updatedAt: now })
          .where(eq(schema.issueRun.id, loaded.run.id))
      },
      catch: (cause) => dbError('mark issue run resumed', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    const db = getIssueRunDb(this.env.DATABASE_URL)
    const eventResult = await appendIssueRunEvent({
      db,
      run: loaded.runState,
      eventType: 'issue_run:message',
      stream: 'system',
      message: 'Run resumed',
      payload: { trigger: this.currentTriggerReason || 'resume' },
    })
    if (eventResult.isErr()) {
      return Result.err(
        new IssueRunSubAgentError({
          code: 'database_failed',
          message: eventResult.error.message,
          cause: eventResult.error,
        }),
      )
    }

    return Result.ok()
  }

  private async persistUsage(
    runId: string,
    usage: IssueRunUsage,
  ): Promise<ResultValue<void, IssueRunSubAgentError>> {
    const normalizedUsage = normalizeRunUsage(usage)
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(schema.issueRun)
          .set({ usageJson: normalizedUsage, updatedAt: new Date() })
          .where(eq(schema.issueRun.id, runId))
      },
      catch: (cause) => dbError('persist issue run usage', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok()
  }

  private async enforceResolutionGuard(
    runId: string,
  ): Promise<ResultValue<void, IssueRunSubAgentError>> {
    if (this.resolutionActions.size > 0) {
      return Result.ok()
    }

    const runStateResult = await this.loadRunState(runId)
    if (runStateResult.isErr()) return Result.err(runStateResult.error)

    const [run] = await this.getDb()
      .select({ status: schema.issueRun.status })
      .from(schema.issueRun)
      .where(eq(schema.issueRun.id, runId))
      .limit(1)
    if (!run || run.status !== 'running') return Result.ok()

    const guardResult = this.readResolutionGuard(runId)
    if (guardResult.isErr()) return Result.err(guardResult.error)

    if ((guardResult.value?.nudge_count ?? 0) <= 0) {
      const writeResult = this.writeResolutionGuard(runId, 1)
      if (writeResult.isErr()) return Result.err(writeResult.error)

      this.currentRunId = runId
      this.currentRunState = runStateResult.value
      const nudgeMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'The previous turn ended without a resolution. Synthesize the gathered context into a useful work product now. Do not expose raw search results as the output; create or revise the issue work product. Only ask a question or mark blocked if a synthesized work product is impossible.',
          },
        ],
      }
      const saveResult = await Result.tryPromise({
        try: async () => await this.saveMessages([nudgeMessage]),
        catch: (cause) => cause,
      })
      if (saveResult.isErr()) {
        if (saveResult.error instanceof IssueRunTurnStopped) {
          return Result.ok()
        }
        return Result.err(
          new IssueRunSubAgentError({
            code: 'runtime_failed',
            message:
              saveResult.error instanceof Error
                ? saveResult.error.message
                : String(saveResult.error),
            cause: saveResult.error,
          }),
        )
      }
      const continueResult = await Result.tryPromise({
        try: async () =>
          await this.continueLastTurn({
            run_id: runId,
            issue_id: runStateResult.value.issueId,
            mode: 'resume',
          }),
        catch: (cause) => cause,
      })
      if (continueResult.isErr()) {
        if (continueResult.error instanceof IssueRunTurnStopped) {
          return Result.ok()
        }
        return Result.err(
          new IssueRunSubAgentError({
            code: 'runtime_failed',
            message:
              continueResult.error instanceof Error
                ? continueResult.error.message
                : String(continueResult.error),
            cause: continueResult.error,
          }),
        )
      }
      return Result.ok()
    }

    return await this.forceCloseFailed(runId, 'no_resolution')
  }

  private hasTerminalResolutionAction() {
    for (const action of this.resolutionActions) {
      if (TERMINAL_RESOLUTION_ACTIONS.has(action)) return true
    }
    return false
  }

  private async finalizeChildIssueResolution(
    runId: string,
  ): Promise<ResultValue<void, IssueRunSubAgentError>> {
    if (
      !this.resolutionActions.has('create_child_issue') ||
      this.hasTerminalResolutionAction()
    ) {
      return Result.ok()
    }

    const runStateResult = await this.loadRunState(runId)
    if (runStateResult.isErr()) return Result.err(runStateResult.error)

    const [run] = await this.getDb()
      .select({ status: schema.issueRun.status })
      .from(schema.issueRun)
      .where(eq(schema.issueRun.id, runId))
      .limit(1)
    if (!run || run.status !== 'running') return Result.ok()

    const db = getIssueRunDb(this.env.DATABASE_URL)
    const statusResult = await updateRunStatus({
      db,
      run: runStateResult.value,
      status: 'succeeded',
      finished: true,
      resultJson: { resolution: 'create_child_issue' },
    })
    if (statusResult.isErr()) {
      return Result.err(
        new IssueRunSubAgentError({
          code: 'database_failed',
          message: statusResult.error.message,
          cause: statusResult.error,
        }),
      )
    }

    const eventResult = await appendIssueRunEvent({
      db,
      run: runStateResult.value,
      eventType: 'issue_run:succeeded',
      stream: 'system',
      message: 'Run succeeded',
      payload: { resolution: 'create_child_issue' },
    })
    if (eventResult.isErr()) {
      return Result.err(
        new IssueRunSubAgentError({
          code: 'database_failed',
          message: eventResult.error.message,
          cause: eventResult.error,
        }),
      )
    }

    return Result.ok()
  }

  private ensureResolutionGuardTable() {
    return Result.try({
      try: () => {
        this.ctx.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS issue_run_resolution_guard (
            run_id TEXT PRIMARY KEY,
            nudge_count INTEGER NOT NULL,
            updated_at TEXT NOT NULL
          )
        `)
      },
      catch: (cause) =>
        new IssueRunSubAgentError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : 'Failed to prepare issue run resolution guard storage.',
          cause,
        }),
    })
  }

  private readResolutionGuard(runId: string) {
    const tableResult = this.ensureResolutionGuardTable()
    if (tableResult.isErr()) return Result.err(tableResult.error)

    const result = Result.try({
      try: () => {
        const rows = Array.from(
          this.ctx.storage.sql.exec(
            `
              SELECT run_id, nudge_count, updated_at
              FROM issue_run_resolution_guard
              WHERE run_id = ?
              LIMIT 1
            `,
            runId,
          ),
        ) as ResolutionGuardRow[]
        return rows[0] ?? null
      },
      catch: (cause) =>
        new IssueRunSubAgentError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : 'Failed to read issue run resolution guard.',
          cause,
        }),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok(result.value)
  }

  private writeResolutionGuard(runId: string, nudgeCount: number) {
    const tableResult = this.ensureResolutionGuardTable()
    if (tableResult.isErr()) return Result.err(tableResult.error)

    return Result.try({
      try: () => {
        this.ctx.storage.sql.exec(
          `
            INSERT INTO issue_run_resolution_guard (run_id, nudge_count, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(run_id) DO UPDATE SET
              nudge_count = excluded.nudge_count,
              updated_at = excluded.updated_at
          `,
          runId,
          nudgeCount,
          new Date().toISOString(),
        )
      },
      catch: (cause) =>
        new IssueRunSubAgentError({
          code: 'database_failed',
          message:
            cause instanceof Error
              ? cause.message
              : 'Failed to write issue run resolution guard.',
          cause,
        }),
    })
  }

  private async setCancelRequested(
    runId: string,
    reason: string,
  ): Promise<ResultValue<void, IssueRunSubAgentError>> {
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(schema.issueRun)
          .set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.issueRun.id, runId))
      },
      catch: (cause) => dbError('request issue run cancellation', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    const runStateResult = await this.loadRunState(runId)
    if (runStateResult.isErr()) return Result.err(runStateResult.error)
    const db = getIssueRunDb(this.env.DATABASE_URL)
    const eventResult = await appendIssueRunEvent({
      db,
      run: runStateResult.value,
      eventType: 'issue_run:message',
      stream: 'system',
      level: reason === 'timeout' ? 'error' : 'warn',
      message:
        reason === 'timeout' ? 'Run timeout reached' : 'Cancellation requested',
      payload: { reason },
    })
    if (eventResult.isErr()) {
      return Result.err(
        new IssueRunSubAgentError({
          code: 'database_failed',
          message: eventResult.error.message,
          cause: eventResult.error,
        }),
      )
    }
    return Result.ok()
  }

  private async cancelRunIfRequested(
    runId: string,
  ): Promise<ResultValue<boolean, IssueRunSubAgentError>> {
    const [run] = await this.getDb()
      .select()
      .from(schema.issueRun)
      .where(eq(schema.issueRun.id, runId))
      .limit(1)
    if (!run?.cancelRequestedAt) return Result.ok(false)
    const runStateResult = await this.loadRunState(runId)
    if (runStateResult.isErr()) return Result.err(runStateResult.error)
    const cancelResult = await this.finishCancelled(
      runStateResult.value,
      'cancelled',
    )
    if (cancelResult.isErr()) return Result.err(cancelResult.error)
    return Result.ok(true)
  }

  private async finishCancelled(
    run: IssueRunToolState,
    reason: string,
  ): Promise<ResultValue<void, IssueRunSubAgentError>> {
    const db = getIssueRunDb(this.env.DATABASE_URL)
    const statusResult = await updateRunStatus({
      db,
      run,
      status: 'cancelled',
      error: reason,
      finished: true,
      resultJson: { resolution: 'cancelled', reason },
    })
    if (statusResult.isErr()) {
      return Result.err(
        new IssueRunSubAgentError({
          code: 'database_failed',
          message: statusResult.error.message,
          cause: statusResult.error,
        }),
      )
    }

    const eventResult = await appendIssueRunEvent({
      db,
      run,
      eventType: 'issue_run:cancelled',
      stream: 'system',
      level: 'warn',
      message: 'Run cancelled',
      payload: { reason },
    })
    if (eventResult.isErr()) {
      return Result.err(
        new IssueRunSubAgentError({
          code: 'database_failed',
          message: eventResult.error.message,
          cause: eventResult.error,
        }),
      )
    }
    return Result.ok()
  }

  private async forceCloseFailed(
    runId: string,
    reason: string,
  ): Promise<ResultValue<void, IssueRunSubAgentError>> {
    const runStateResult = await this.loadRunState(runId)
    if (runStateResult.isErr()) return Result.err(runStateResult.error)

    const run = runStateResult.value
    const db = this.getDb()
    const now = new Date()

    const writeResult = await Result.tryPromise({
      try: async () => {
        await db.transaction(async (tx) => {
          await tx
            .update(schema.issueRun)
            .set({
              status: 'failed',
              error: reason,
              resultJson: { resolution: 'failed', reason },
              finishedAt: now,
              updatedAt: now,
            })
            .where(eq(schema.issueRun.id, runId))
          await tx
            .update(schema.issue)
            .set({ activeRunId: null, updatedAt: now })
            .where(eq(schema.issue.id, run.issueId))
        })
      },
      catch: (cause) => dbError('force close failed issue run', cause),
    })
    if (writeResult.isErr()) return Result.err(writeResult.error)

    const eventDb = getIssueRunDb(this.env.DATABASE_URL)
    const eventResult = await appendIssueRunEvent({
      db: eventDb,
      run,
      eventType: 'issue_run:failed',
      stream: 'system',
      level: 'error',
      message: 'Run failed',
      payload: {
        reason,
      },
    })
    if (eventResult.isErr()) {
      return Result.err(
        new IssueRunSubAgentError({
          code: 'database_failed',
          message: eventResult.error.message,
          cause: eventResult.error,
        }),
      )
    }

    return Result.ok()
  }

  private clearTurnState() {
    this.currentRunId = null
    this.currentRunState = null
    this.currentPermissions = null
    this.currentTriggerReason = ''
    this.resolutionActions.clear()
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
      addRpcMcpServer: async ({ connectorId, id, props }) =>
        await this.addMcpServer(
          connectorId,
          this.env.MCP_SESSION as unknown as DurableObjectNamespace<McpAgent>,
          { id, props },
        ),
      removeMcpServer: this.removeMcpServer.bind(this),
      resolveRuntimeIdentity: async () => await this.resolveIssueMcpIdentity(),
    }
    return new RuntimeMcpController(host)
  }

  private async resolveIssueMcpIdentity(): Promise<
    ResultValue<ThreadRuntimeIdentity, RuntimeMcpError>
  > {
    const runId = this.currentRunId
    if (!runId) {
      return Result.err(
        new RuntimeMcpError({
          code: 'thread_not_found',
          message: 'Issue MCP identity requested outside an active run.',
        }),
      )
    }

    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await this.getDb()
          .select({
            workspaceId: schema.issueRun.workspaceId,
            issueId: schema.issueRun.issueId,
            userId: schema.agent.ownerUserId,
            agentId: schema.issueRun.agentId,
          })
          .from(schema.issueRun)
          .innerJoin(schema.agent, eq(schema.agent.id, schema.issueRun.agentId))
          .where(eq(schema.issueRun.id, runId))
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
              : 'Failed to load issue MCP identity.',
        }),
      )
    }
    if (!result.value) {
      return Result.err(
        new RuntimeMcpError({
          code: 'thread_not_found',
          message: 'Issue run not found for MCP identity.',
        }),
      )
    }

    return Result.ok({
      threadId: this.name,
      workspaceId: result.value.workspaceId,
      userId: result.value.userId,
      agentId: result.value.agentId,
      issueId: result.value.issueId,
      runId,
    })
  }

  private async ensureMcpConnectionsForTool() {
    const result = await this.mcpConnectionPreparer.ensureLoaded('read-source')
    if (result.isOk()) return Result.ok(undefined)

    return Result.err(
      new IssueRunToolError({
        code: 'connector_failed',
        message: result.error,
        connectorError: classifyConnectorError(result.error),
      }),
    )
  }

  private async ensureProxyMcpConnectionsForTurn() {
    return await this.mcpConnectionPreparer.ensureForTurn('issue-turn')
  }
}
