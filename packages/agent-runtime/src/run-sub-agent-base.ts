import {
  Think,
  type ChatResponseResult,
  type Session,
  type StepContext,
  type SubmitMessagesResult,
  type ThinkSubmissionInspection,
  type TurnConfig,
  type TurnContext,
} from '@cloudflare/think'
import { Workspace } from '@cloudflare/shell'
import type { Connection } from 'agents'
import type { McpAgent } from 'agents/mcp'
import { getSandbox, type Sandbox as SandboxDO } from '@cloudflare/sandbox'
import type { LanguageModel, UIMessage } from 'ai'
import { Result, type Result as ResultValue } from 'better-result'
import { eq } from 'drizzle-orm'
import { getPooledDb } from '@garden/db/runtime'
import * as schema from '@garden/db/schema'
import type { AgentPermissions } from '@garden/core/agents/permissions'
import type {
  GardenLogFields,
  GardenLogger,
} from '@garden/observability/logger'
import { evaluateRuntimeToolPermission } from './chat-permissions'
import {
  type AgentModelEnv,
  createAgentModel,
  resolveAgentModelProfile,
} from './model'
import { AiObservation, type AiTurnIdentity } from './ai-observation'
import {
  classifyGardenContextOverflow,
  configureThinkCompaction,
  createGardenContextOverflow,
} from './think-compaction'
import {
  RuntimeMcpConnectionPreparer,
  RuntimeMcpController,
  type McpHost,
  type RuntimeMcpError,
  type RuntimeMcpServerStates,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'
import { mcpRuntimeConfig } from './mcp-runtime-config'
import { assembleFoundationPrompt } from './prompt'
import { loadRuntimeSkillSources } from './skills'
import {
  addStepUsage,
  normalizeRunUsage,
  type RunUsageSnapshot,
} from './run-usage'
import {
  getRunWorkflowTurnCompleteEventType,
  type RunWorkflowBinding,
  type RunWorkflowTurnCompleteEvent,
  type RunWorkflowTurnStartResult,
} from './run-workflow'
import { logAgentSocketError } from './websocket-errors'
import {
  agentSandboxId,
  errorMessage,
  isTerminalSubmissionStatus,
  operationFailedMessage,
} from './runtime-utils'

/**
 * Shared lifecycle for the per-run Think facets (`IssueRunSubAgent` and
 * `AutomationRunSubAgent`).
 *
 * Both facets used to carry their own copy of workflow submission,
 * cancellation, timeout guards, usage persistence, sandbox and MCP wiring.
 * This base owns that lifecycle; subclasses supply only what differs: the
 * run ledger table, the per-run context block, the tools, how a run is marked
 * started/cancelled/failed, and the finish policy for a settled turn.
 */

export type RunSubAgentEnv = Cloudflare.Env &
  AgentModelEnv & {
    BETTER_AUTH_SECRET: string
    BETTER_AUTH_URL: string
    HYPERDRIVE: Hyperdrive
    DISCORD_BOT_TOKEN?: string
    EXA_API_KEY?: string
    AI: Ai
    AI_GATEWAY_ID?: string
    ENVIRONMENT?: string
    VITE_PUBLIC_POSTHOG_HOST?: string
    VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string
    BRAIN_FILES: R2Bucket
    FILES: R2Bucket
    LOADER: WorkerLoader
    Sandbox: DurableObjectNamespace<SandboxDO>
    MCP_SESSION: DurableObjectNamespace
    RUN_WORKFLOW: RunWorkflowBinding
    HELIX_URL?: string
    HELIX_API_KEY?: string
  }

export type RunKind = 'issue' | 'automation'

export type RunTurnMode = 'start' | 'resume'

export type RunTurnInput = {
  runId: string
  turn: number
}

export type RunSubAgentErrorCode =
  | 'database_failed'
  | 'invalid_state'
  | 'not_found'
  | 'runtime_failed'

export type RunSubAgentErrorFields = {
  code: RunSubAgentErrorCode
  message: string
  cause?: unknown
}

/**
 * Structural type of the run facets' tagged errors. Each facet keeps its own
 * tag (`IssueRunSubAgentError`, `AutomationRunSubAgentError`) so error names
 * in logs and Workflow failures stay as they were.
 */
export type RunSubAgentError = Error &
  Readonly<RunSubAgentErrorFields> & { readonly _tag: string }

/**
 * Thrown from `beforeTurn` when a boundary guard (cancellation, timeout or a
 * run that is no longer live) stops the turn. `submitWorkflowTurn` treats it
 * as a clean stop rather than a failure.
 */
export class RunTurnStopped extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

export type RunSubAgentConfig = {
  kind: RunKind
  /** Concrete class name, used in error text and telemetry metadata. */
  agentClass: string
  logger: GardenLogger
}

/** The run ledger row fields the shared boundary guards read. */
export type LoadedRun = {
  contextBlock: string
  permissions: AgentPermissions
  run: {
    id: string
    agentId: string
    status: string
    cancelRequestedAt: Date | null
    startedAt: Date | null
    createdAt: Date | null
  }
}

type RunLedgerTable = typeof schema.issueRun | typeof schema.automationRun

type DriveTurnResult =
  | { kind: 'stopped' }
  | {
      kind: 'submitted'
      status: SubmitMessagesResult['status']
      submissionId: string
    }

type BoundaryGuardResult = 'continue' | 'cancelled' | 'timeout'

const DEFAULT_RUN_TIMEOUT_SEC = 2 * 60 * 60
const THINK_TURN_MAX_RETRIES = 1

export abstract class RunSubAgentBase<
  TLoaded extends LoadedRun,
  TInput extends RunTurnInput,
  TEnv extends RunSubAgentEnv = RunSubAgentEnv,
> extends Think<TEnv> {
  /**
   * Handles run websocket disconnects as expected lifecycle churn while
   * preserving non-connection runtime failures as errors. This prevents deploy
   * or client network closes from polluting observability as app exceptions.
   */
  override onError(connection: Connection, error: unknown): void
  override onError(error: unknown): void
  override onError(connectionOrError: Connection | unknown, error?: unknown) {
    const config = this.runConfig()
    logAgentSocketError({
      logger: config.logger,
      component: `${config.kind}-run-sub-agent`,
      connection:
        error === undefined ? null : (connectionOrError as Connection),
      error: error ?? connectionOrError,
    })
  }

  override chatRecovery = true
  override contextOverflow = createGardenContextOverflow(
    // Field initializers run after super(), so this.env is populated: offline
    // local models need overflow bounds scaled to their context window, not
    // the 262k Workers AI default.
    resolveAgentModelProfile(this.env),
  )
  override classifyChatError = classifyGardenContextOverflow

  waitForMcpConnections = {
    timeout: mcpRuntimeConfig.connectionWaitTimeoutMs,
  }

  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.FILES,
    name: () => this.name,
  })

  protected currentRunId: string | null = null
  protected currentPermissions: AgentPermissions | null = null
  protected aggUsage: RunUsageSnapshot | null = null
  protected readonly aiObservation = new AiObservation(this.ctx, this.env)
  private readonly mcpConnectionPreparer = new RuntimeMcpConnectionPreparer({
    getController: () => this.getMcpController(),
    fullSyncIntervalMs: mcpRuntimeConfig.connectorFullSyncIntervalMs,
    waitForConnections: async (timeoutMs) =>
      await this.mcp.waitForConnections({ timeout: timeoutMs }),
    getServerStates: () =>
      this.getMcpServers().servers as RuntimeMcpServerStates,
    connectionWaitTimeoutMs: mcpRuntimeConfig.connectionWaitTimeoutMs,
    backgroundRefreshFailedMessage: `[agent-runtime] ${this.runConfig().kind} MCP background refresh failed`,
    refreshFailedMessage: `[agent-runtime] ${this.runConfig().kind} MCP connector refresh failed`,
    continuingWithoutReadyMessage: `[agent-runtime] ${this.runConfig().kind} MCP connectors are not ready`,
    readinessPolicy: 'required',
  })

  maxSteps = 30

  /**
   * Identifies the run kind. A method rather than a field so the base's own
   * field initializers can read it before subclass fields exist.
   */
  protected abstract runConfig(): RunSubAgentConfig
  /** The Postgres ledger table that holds this kind of run. */
  protected abstract runTable(): RunLedgerTable
  protected abstract runError(fields: RunSubAgentErrorFields): RunSubAgentError
  /** Run-kind instructions added to the session after the foundation prompt. */
  protected abstract runInstructionsContext(): {
    key: string
    description: string
    get: () => Promise<string>
  }
  protected abstract loadTurnContext(
    runId: string,
  ): Promise<ResultValue<TLoaded, RunSubAgentError>>
  protected abstract isActiveRunStatus(status: string): boolean
  /** Copies run-specific state from a loaded context onto the facet. */
  protected abstract activateRun(loaded: TLoaded): void
  /** Resets per-turn state at the start of a Think turn. */
  protected abstract startTurnState(runId: string, loaded: TLoaded): void
  protected abstract observationIdentity(
    loaded: TLoaded,
    runId: string,
  ): AiTurnIdentity
  /** Correlation fields for turn logs, or null to skip turn logging. */
  protected abstract runLogFields(): GardenLogFields | null
  protected abstract turnStopConditions(): NonNullable<TurnConfig['stopWhen']>
  protected abstract turnPrompt(mode: RunTurnMode): string
  protected abstract turnMetadata(
    mode: RunTurnMode,
    input: TInput,
  ): Record<string, unknown>
  protected abstract markRunStarted(
    loaded: TLoaded,
  ): Promise<ResultValue<void, RunSubAgentError>>
  protected abstract markRunResumed(
    loaded: TLoaded,
  ): Promise<ResultValue<void, RunSubAgentError>>
  protected abstract setCancelRequested(
    runId: string,
    reason: string,
  ): Promise<ResultValue<void, RunSubAgentError>>
  /** Moves a live run to `cancelled`; a no-op for runs already settled. */
  protected abstract finishCancelledRun(
    runId: string,
    reason: string,
    loaded?: TLoaded,
  ): Promise<ResultValue<void, RunSubAgentError>>
  /** Moves a live run to `failed`; a no-op for runs already settled. */
  protected abstract forceCloseFailed(
    runId: string,
    reason: string,
    loaded?: TLoaded,
  ): Promise<ResultValue<void, RunSubAgentError>>
  /**
   * The finish policy for a turn that ended normally (not aborted or errored).
   * Turn state is cleared by the caller afterwards.
   */
  protected abstract finishSettledTurn(
    runId: string,
    result: ChatResponseResult,
  ): Promise<void>
  protected abstract resolveMcpIdentity(): Promise<
    ResultValue<ThreadRuntimeIdentity, RuntimeMcpError>
  >

  /** Called after a turn has started and been logged. */
  protected async onTurnStarted(_runId: string): Promise<void> {}

  /** Called for each finished step, after usage is aggregated. */
  protected async onRunStepFinished(
    _runId: string,
    _ctx: StepContext,
    _usage: RunUsageSnapshot,
  ): Promise<void> {}

  protected telemetryMetadata(runId: string): Record<string, string> {
    return { agentClass: this.runConfig().agentClass, runId }
  }

  getModel(): LanguageModel {
    return createAgentModel({
      ai: this.env.AI,
      env: this.env,
      gatewayId: this.env.AI_GATEWAY_ID,
    })
  }

  override async configureSession(session: Session) {
    const instructions = this.runInstructionsContext()
    return configureThinkCompaction(
      session,
      this.getModel(),
      resolveAgentModelProfile(this.env),
    )
      .withContext('foundation', {
        description:
          'Base Garden operating contract. Later context refines this but does not override it.',
        provider: {
          get: async () => assembleFoundationPrompt(),
        },
      })
      .withContext(instructions.key, {
        description: instructions.description,
        provider: { get: instructions.get },
      })
      .withCachedPrompt()
  }

  override getSkills() {
    return loadRuntimeSkillSources(
      {
        bucket: this.env.FILES,
        databaseUrl: this.env.HYPERDRIVE.connectionString,
      },
      { kind: this.runConfig().kind, id: this.name },
    )
  }

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig | void> {
    const config = this.runConfig()
    const bodyRunId = ctx.body?.run_id
    const runId =
      this.currentRunId ??
      (typeof bodyRunId === 'string' && bodyRunId.trim()
        ? bodyRunId.trim()
        : null)
    if (!runId) {
      throw this.runError({
        code: 'invalid_state',
        message: `${config.agentClass}.beforeTurn missing run_id.`,
      })
    }

    const loadedResult = await this.loadTurnContext(runId)
    if (loadedResult.isErr()) throw loadedResult.error

    const guardResult = await this.applyRunBoundaryGuards(loadedResult.value)
    if (guardResult.isErr()) throw guardResult.error
    if (guardResult.value !== 'continue') {
      throw new RunTurnStopped(this.turnStoppedName(), guardResult.value)
    }

    this.currentRunId = runId
    this.currentPermissions = loadedResult.value.permissions
    this.activateRun(loadedResult.value)
    this.startTurnState(runId, loadedResult.value)
    this.aggUsage = null
    this.aiObservation.startTurn(
      this.observationIdentity(loadedResult.value, runId),
      ctx,
    )
    config.logger.info(
      `${config.kind}_run.turn.started`,
      this.runLogFields() ?? undefined,
    )
    await this.onTurnStarted(runId)

    const mcpController = await this.mcpConnectionPreparer.ensureForTurn(
      `${config.kind}-turn`,
    )
    const observedChangesResult = mcpController.captureObservedMcpToolChanges()
    if (observedChangesResult.isErr()) {
      console.warn(
        `[agent-runtime] failed to capture MCP tool changes for ${config.kind} run`,
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
      model: createAgentModel({
        ai: this.env.AI,
        env: this.env,
        gatewayId: this.env.AI_GATEWAY_ID,
        tracing: this.aiObservation.modelTracing(),
      }),
      experimental_telemetry: {
        functionId: `garden.${config.kind}-run.turn`,
        isEnabled: true,
        metadata: this.telemetryMetadata(runId),
        recordInputs: false,
        recordOutputs: false,
      },
      maxRetries: THINK_TURN_MAX_RETRIES,
      maxSteps: this.maxSteps,
      sendReasoning: true,
      stopWhen: this.turnStopConditions(),
      system: `${ctx.system}\n\n${loadedResult.value.contextBlock}`,
      tools: stableMcpTools,
      activeTools: mcpController.activeToolKeysWithoutRawMcp({
        assembledTools: ctx.tools,
        stableMcpTools,
      }),
    } satisfies TurnConfig
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
      console.warn(
        `[agent-runtime] failed to notify ${this.runConfig().kind} workflow turn`,
        {
          error: errorMessage(sendResult.error),
          runId,
          submissionId: submission.submissionId,
        },
      )
    }
  }

  override async onStepFinish(ctx: StepContext) {
    this.aiObservation.stepFinished(ctx)
    const runId = this.currentRunId
    if (!runId) return

    const nextUsage = addStepUsage(this.aggUsage, ctx)
    this.aggUsage = nextUsage

    await this.onRunStepFinished(runId, ctx, nextUsage)

    const persistResult = await this.persistUsage(runId, nextUsage)
    if (persistResult.isErr()) {
      console.warn(
        `[agent-runtime] failed to persist ${this.runConfig().kind} run usage`,
        {
          error: persistResult.error.message,
          runId,
        },
      )
    }
  }

  override async onChatResponse(result: ChatResponseResult) {
    const runId = this.currentRunId
    if (!runId) return

    const config = this.runConfig()
    const logFields = this.runLogFields()
    if (logFields) {
      config.logger.info(`${config.kind}_run.turn.finished`, {
        ...logFields,
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
        console.warn(
          `[agent-runtime] failed to apply ${config.kind} run cancellation`,
          { error: cancelResult.error.message, runId },
        )
      } else if (!cancelResult.value) {
        const failedResult = await this.forceCloseFailed(runId, 'turn_aborted')
        if (failedResult.isErr()) {
          console.warn(
            `[agent-runtime] failed to close aborted ${config.kind} run`,
            { error: failedResult.error.message, runId },
          )
        }
      }
    } else if (result.status === 'error') {
      const failedResult = await this.forceCloseFailed(
        runId,
        result.error ?? 'chat_error',
      )
      if (failedResult.isErr()) {
        console.warn(
          `[agent-runtime] failed to close errored ${config.kind} run`,
          { error: failedResult.error.message, runId },
        )
      }
    } else {
      await this.finishSettledTurn(runId, result)
    }

    this.aiObservation.finishTurn(result)
    this.clearTurnState()
  }

  /**
   * Submits one idempotent Think turn for RunWorkflow and returns as soon as the
   * SDK ledger accepts it. The previous implementation waited inside the DO
   * with an arbitrary timer; Workflow now does the durable wait via the terminal
   * submission event emitted from `onSubmissionStatus`.
   *
   * This and `completeWorkflowTurn` are Workflow RPC targets, so failures are
   * thrown (the Workflow step must reject to retry) — always as the run's
   * tagged error, keeping its code and cause.
   */
  async executeWorkflowTurn(
    mode: RunTurnMode,
    input: TInput,
  ): Promise<RunWorkflowTurnStartResult> {
    const table = this.runTable()
    const [runRow] = await this.getDb()
      .select({
        cancelRequestedAt: table.cancelRequestedAt,
        status: table.status,
      })
      .from(table)
      .where(eq(table.id, input.runId))
      .limit(1)

    if (runRow?.cancelRequestedAt) {
      const cancelResult = await this.finishCancelledRun(
        input.runId,
        'cancelled',
      )
      if (cancelResult.isErr()) {
        await this.forceCloseFailed(input.runId, cancelResult.error.message)
        throw cancelResult.error
      }
      return { kind: 'run_status', status: 'cancelled' }
    }

    const driveResult = await this.driveTurn(mode, input)
    if (driveResult.isErr()) {
      await this.forceCloseFailed(input.runId, driveResult.error.message)
      throw driveResult.error
    }
    if (driveResult.value.kind === 'stopped') {
      const statusResult = await this.readRunStatus(input.runId)
      if (statusResult.isErr()) {
        await this.forceCloseFailed(input.runId, statusResult.error.message)
        throw statusResult.error
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
    const kind = this.runConfig().kind
    const inspectionResult = await Result.tryPromise({
      try: async () => await this.inspectSubmission(input.submissionId),
      catch: (cause) => cause,
    })
    if (inspectionResult.isErr()) {
      await this.forceCloseFailed(input.runId, String(inspectionResult.error))
      throw this.runtimeFailure(inspectionResult.error)
    }

    const inspection = inspectionResult.value
    if (!inspection) {
      const message = `Submitted ${kind} turn ${input.submissionId} was not found.`
      await this.forceCloseFailed(input.runId, message)
      throw this.runError({ code: 'not_found', message })
    }
    if (!isTerminalSubmissionStatus(inspection.status)) {
      throw this.runError({
        code: 'invalid_state',
        message: `Submitted ${kind} turn ${input.submissionId} is still ${inspection.status}.`,
      })
    }

    if (inspection.status === 'error') {
      const failedResult = await this.forceCloseFailed(
        input.runId,
        inspection.error ?? `Submitted ${kind} turn failed.`,
      )
      if (failedResult.isErr()) throw failedResult.error
      this.clearTurnState()
    }
    if (inspection.status === 'aborted') {
      const cancelResult = await this.cancelRunIfRequested(input.runId)
      if (cancelResult.isErr()) {
        await this.forceCloseFailed(input.runId, cancelResult.error.message)
        throw cancelResult.error
      }
      if (!cancelResult.value) {
        const failedResult = await this.forceCloseFailed(
          input.runId,
          'turn_aborted',
        )
        if (failedResult.isErr()) throw failedResult.error
      }
      this.clearTurnState()
    }
    if (inspection.status === 'skipped') {
      const failedResult = await this.forceCloseFailed(
        input.runId,
        'turn_skipped',
      )
      if (failedResult.isErr()) throw failedResult.error
      this.clearTurnState()
    }

    const statusResult = await this.readRunStatus(input.runId)
    if (statusResult.isErr()) {
      await this.forceCloseFailed(input.runId, statusResult.error.message)
      throw statusResult.error
    }
    return { status: statusResult.value }
  }

  async requestCancel(input: { runId: string }): Promise<void> {
    const cancelResult = await this.setCancelRequested(input.runId, 'cancelled')
    if (cancelResult.isErr()) {
      console.warn(
        `[agent-runtime] failed to request ${this.runConfig().kind} run cancellation`,
        {
          error: cancelResult.error.message,
          runId: input.runId,
        },
      )
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
    const kind = this.runConfig().kind
    const submissionsResult = await Result.tryPromise({
      try: async () =>
        await this.listSubmissions({ status: ['pending', 'running'] }),
      catch: (cause) => cause,
    })
    if (submissionsResult.isErr()) {
      console.warn(`[agent-runtime] failed to list ${kind} submissions`, {
        error: errorMessage(submissionsResult.error),
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
      console.warn(`[agent-runtime] failed to cancel ${kind} submissions`, {
        error: errorMessage(cancelResult.error),
        runId,
      })
    }
  }

  private async driveTurn(
    mode: RunTurnMode,
    input: TInput,
  ): Promise<ResultValue<DriveTurnResult, RunSubAgentError>> {
    const loadedResult = await this.loadTurnContext(input.runId)
    if (loadedResult.isErr()) return Result.err(loadedResult.error)

    const boundaryResult = await this.applyRunBoundaryGuards(loadedResult.value)
    if (boundaryResult.isErr()) return Result.err(boundaryResult.error)
    if (boundaryResult.value !== 'continue') {
      return Result.ok({ kind: 'stopped' })
    }

    const statusResult =
      mode === 'start'
        ? await this.markRunStarted(loadedResult.value)
        : await this.markRunResumed(loadedResult.value)
    if (statusResult.isErr()) return Result.err(statusResult.error)

    this.currentRunId = input.runId
    this.currentPermissions = loadedResult.value.permissions
    this.activateRun(loadedResult.value)

    const submissionId = `${this.runConfig().kind}-run:${input.runId}:${input.turn}:${mode}`
    const message: UIMessage = {
      id: `${submissionId}:user`,
      role: 'user',
      parts: [{ type: 'text', text: this.turnPrompt(mode) }],
    }

    return await this.submitWorkflowTurn({
      submissionId,
      message,
      metadata: this.turnMetadata(mode, input),
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
  }): Promise<ResultValue<DriveTurnResult, RunSubAgentError>> {
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
      if (submitResult.error instanceof RunTurnStopped) {
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

  protected runtimeFailure(cause: unknown) {
    return this.runError({
      code: 'runtime_failed',
      message: errorMessage(cause),
      cause,
    })
  }

  protected dbError(operation: string, cause: unknown) {
    return this.runError({
      code: 'database_failed',
      message: operationFailedMessage(operation, cause),
      cause,
    })
  }

  /** `IssueRunTurnStopped` / `AutomationRunTurnStopped`, as before. */
  private turnStoppedName() {
    return `${this.runConfig().agentClass.replace(/SubAgent$/, '')}TurnStopped`
  }

  /**
   * Resolves the run facet's Drizzle client through Hyperdrive's pooled
   * connection string. Previously called `drizzle(this.env.DATABASE_URL)` from
   * the neon-serverless driver, opening a fresh direct-to-Neon WebSocket pool
   * per call that bypassed Hyperdrive, never closed, and defeated Neon
   * autosuspend. `getPooledDb` memoizes one node-postgres pool per connection
   * string per isolate so Hyperdrive owns origin pooling.
   */
  protected getDb() {
    return getPooledDb(this.env.HYPERDRIVE.connectionString)
  }

  protected getAgentSandbox() {
    const sandboxId = agentSandboxId({
      selfPath: this.selfPath,
      parentPath: this.parentPath,
      name: this.name,
    })
    return getSandbox(this.env.Sandbox, sandboxId, {
      normalizeId: true,
      sleepAfter: '5m',
      transport: 'rpc',
    })
  }

  /** Applies the agent's tool permissions to a runtime tool call. */
  protected assertToolAllowed(
    runtimeToolName: string,
  ): ResultValue<void, RunSubAgentError> {
    const decision = evaluateRuntimeToolPermission(
      this.currentPermissions,
      runtimeToolName,
    )
    if (decision.allowed) return Result.ok()
    return Result.err(
      this.runError({
        code: 'runtime_failed',
        message: decision.reason,
      }),
    )
  }

  private shouldAutoApproveRiskClass(riskClass: string) {
    const permissions = this.currentPermissions
    if (!permissions) return false
    if (riskClass !== 'send_external' && riskClass !== 'destructive') {
      return false
    }
    return permissions.approval_overrides[riskClass] === 'auto'
  }

  protected async readRunStatus(
    runId: string,
  ): Promise<ResultValue<string, RunSubAgentError>> {
    const table = this.runTable()
    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await this.getDb()
          .select({ status: table.status })
          .from(table)
          .where(eq(table.id, runId))
          .limit(1)
        return row?.status ?? 'unknown'
      },
      catch: (cause) =>
        this.dbError(`load ${this.runConfig().kind} run status`, cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok(result.value)
  }

  /**
   * Stops a turn before it starts when the run is no longer live, was asked to
   * cancel, or has outlived the agent's run timeout.
   */
  private async applyRunBoundaryGuards(
    loaded: TLoaded,
  ): Promise<ResultValue<BoundaryGuardResult, RunSubAgentError>> {
    if (!this.isActiveRunStatus(loaded.run.status)) {
      return Result.ok('cancelled')
    }

    if (loaded.run.cancelRequestedAt) {
      const cancelResult = await this.finishCancelledRun(
        loaded.run.id,
        'cancelled',
        loaded,
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
      const failedResult = await this.forceCloseFailed(
        loaded.run.id,
        'timeout',
        loaded,
      )
      if (failedResult.isErr()) return Result.err(failedResult.error)
      return Result.ok('timeout')
    }

    return Result.ok('continue')
  }

  private async loadRunTimeoutSec(
    agentId: string,
  ): Promise<ResultValue<number, RunSubAgentError>> {
    const result = await Result.tryPromise({
      try: async () => {
        const [agent] = await this.getDb()
          .select({ runTimeoutSec: schema.agent.runTimeoutSec })
          .from(schema.agent)
          .where(eq(schema.agent.id, agentId))
          .limit(1)
        return Math.max(
          agent?.runTimeoutSec ?? DEFAULT_RUN_TIMEOUT_SEC,
          DEFAULT_RUN_TIMEOUT_SEC,
        )
      },
      catch: (cause) =>
        this.dbError(`load ${this.runConfig().kind} run timeout`, cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok(result.value)
  }

  private async persistUsage(
    runId: string,
    usage: RunUsageSnapshot,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    const table = this.runTable()
    const normalizedUsage = normalizeRunUsage(usage)
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(table)
          .set({ usageJson: normalizedUsage, updatedAt: new Date() })
          .where(eq(table.id, runId))
      },
      catch: (cause) =>
        this.dbError(`persist ${this.runConfig().kind} run usage`, cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok()
  }

  /** Cancels the run if cancellation was requested; returns whether it did. */
  private async cancelRunIfRequested(
    runId: string,
  ): Promise<ResultValue<boolean, RunSubAgentError>> {
    const table = this.runTable()
    const [run] = await this.getDb()
      .select({ cancelRequestedAt: table.cancelRequestedAt })
      .from(table)
      .where(eq(table.id, runId))
      .limit(1)
    if (!run?.cancelRequestedAt) return Result.ok(false)
    const cancelResult = await this.finishCancelledRun(runId, 'cancelled')
    if (cancelResult.isErr()) return Result.err(cancelResult.error)
    return Result.ok(true)
  }

  protected clearTurnState() {
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
      addRpcMcpServer: async ({ connectorId, id, props }) =>
        await this.addMcpServer(
          connectorId,
          this.env.MCP_SESSION as unknown as DurableObjectNamespace<McpAgent>,
          { id, props },
        ),
      removeMcpServer: this.removeMcpServer.bind(this),
      resolveRuntimeIdentity: async () => await this.resolveMcpIdentity(),
    }
    return new RuntimeMcpController(host)
  }

  /** Loads MCP connections on demand for a tool that needs them mid-turn. */
  protected async ensureMcpConnectionsLoaded(reason: string) {
    return await this.mcpConnectionPreparer.ensureLoaded(reason)
  }
}
