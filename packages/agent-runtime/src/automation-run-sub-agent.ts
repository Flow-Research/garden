import type {
  ChatResponseResult,
  StepContext,
  ToolCallContext,
  ToolCallResultContext,
} from '@cloudflare/think'
import { createWorkspaceStateBackend } from '@cloudflare/shell'
import { createExecuteTool } from '@cloudflare/think/tools/execute'
import { createBrowserTools } from 'agents/browser/ai'
import { hasToolCall, tool, type ToolSet } from 'ai'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  isQaSweepAutomation,
  parseAutomationExecutionConfig,
  parseQaSweepRunPayload,
  type QaSweepClosureAction,
} from '@garden/core/automations/templates'
import {
  createGardenLogger,
  errorFields,
  type GardenLogFields,
} from '@garden/observability/logger'
import {
  GARDEN_ANALYTICS_EVENTS,
  type GardenAnalyticsEventName,
} from '@garden/observability/analytics/events'
import { connectorRegistry } from '@garden/connectors'
import { connectorToolForName } from './chat-permissions'
import {
  derivePermissions,
  type AgentPermissions,
} from '@garden/core/agents/permissions'
import * as schema from '@garden/db/schema'
import type { AiTurnIdentity } from './ai-observation'
import {
  RuntimeMcpError,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'
import { createSandboxTools } from './sandbox-tools'
import { createWebTools, type WebToolsSqlValue } from './agent-tools/web'
import { createBrainTools } from './agent-tools/brain'
import type { RunUsageSnapshot } from './run-usage'
import { errorMessage, objectOrNull } from './runtime-utils'
import {
  RunSubAgentBase,
  type RunSubAgentConfig,
  type RunSubAgentEnv,
  type RunSubAgentError,
  type RunSubAgentErrorFields,
  type RunTurnInput,
  type RunTurnMode,
} from './run-sub-agent-base'

type AutomationRunEnv = RunSubAgentEnv & {
  BROWSER: Fetcher
}

type AutomationTraceEvent = {
  ts: string
  kind:
    | 'turn_started'
    | 'tool_started'
    | 'tool_finished'
    | 'step_finished'
    | 'run_completed'
    | 'run_failed'
  step?: number
  toolName?: string
  toolCallId?: string
  durationMs?: number
  ok?: boolean
  finishReason?: string
  textPreview?: string
  inputPreview?: string
  outputPreview?: string
  error?: string
  usage?: RunUsageSnapshot | null
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

type QaSweepClosureControls = {
  closureAction: QaSweepClosureAction
  allowSourceMutation: boolean
}

type AutomationRunContextSnapshot = {
  source?: string
  payload?: unknown
}

const automationRunLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'automation-run-sub-agent',
})
const AUTOMATION_RUN_CONFIG: RunSubAgentConfig = {
  kind: 'automation',
  agentClass: 'AutomationRunSubAgent',
  logger: automationRunLogger,
}
const AUTOMATION_RUN_TERMINAL_TOOL_STOP_CONDITIONS = [
  hasToolCall('complete_automation'),
]
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
)<RunSubAgentErrorFields>() {}

function previewString(value: string, maxLength = 1200) {
  const trimmed = value.trim()
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}…`
    : trimmed
}

function previewUnknown(value: unknown) {
  if (typeof value === 'string') return previewString(value)
  const result = Result.try({
    try: () => JSON.stringify(value),
    catch: () => null,
  })
  if (result.isErr() || result.value === null) return String(value)
  return previewString(result.value)
}

function isActiveAutomationRunStatus(status: string) {
  return (ACTIVE_AUTOMATION_RUN_STATUSES as readonly string[]).includes(status)
}

function isTerminalAutomationRunStatus(status: string) {
  return (TERMINAL_AUTOMATION_RUN_STATUSES as readonly string[]).includes(
    status,
  )
}

function automationAllowsBrowser(
  automation: typeof schema.automation.$inferSelect,
) {
  const parsed = parseAutomationExecutionConfig(automation.executionConfig)
  return parsed.success && parsed.data.capabilities.browser
}

export class AutomationRunSubAgent extends RunSubAgentBase<
  LoadedAutomationRunContext,
  RunTurnInput,
  AutomationRunEnv
> {
  private currentBrowserAllowed = false
  /** QA sweep closure controls for the current run; null for other automations. */
  private currentClosureControls: QaSweepClosureControls | null = null
  private currentLogContext: GardenLogFields | null = null
  private currentTrace: AutomationTraceEvent[] = []

  protected runConfig() {
    return AUTOMATION_RUN_CONFIG
  }

  protected runTable() {
    return schema.automationRun
  }

  protected runError(fields: RunSubAgentErrorFields) {
    return new AutomationRunSubAgentError(fields)
  }

  protected runInstructionsContext() {
    return {
      key: 'automation-run',
      description: 'Standalone automation-run behavior and output discipline.',
      get: async () =>
        [
          'You are executing a standalone Garden automation.',
          'This is not an issue, should not create a kanban card, and has no issue timeline.',
          'Complete the configured automation task directly, then call complete_automation exactly once with a non-empty output.',
          'Do not call complete_automation until required connector/tool work is finished.',
          'Only inspect or modify Garden issues when the automation prompt explicitly asks for issue work.',
        ].join('\n'),
    }
  }

  protected isActiveRunStatus(status: string) {
    return isActiveAutomationRunStatus(status)
  }

  protected activateRun(loaded: LoadedAutomationRunContext) {
    this.currentBrowserAllowed = automationAllowsBrowser(loaded.automation)
    this.applyClosureControls(loaded)
  }

  protected startTurnState(runId: string, loaded: LoadedAutomationRunContext) {
    this.currentLogContext = {
      userId: loaded.agent.ownerUserId,
      workspaceId: loaded.run.workspaceId,
      agentId: loaded.run.agentId,
      automationId: loaded.run.automationId,
      runId,
    }
    this.currentTrace = []
  }

  protected observationIdentity(
    loaded: LoadedAutomationRunContext,
    runId: string,
  ): AiTurnIdentity {
    return {
      runtimeKind: 'automation_run',
      distinctId: loaded.agent.ownerUserId,
      workspaceId: loaded.run.workspaceId,
      agentId: loaded.run.agentId,
      automationId: loaded.run.automationId,
      runId,
      traceId: runId,
      sessionId: `automation-run:${runId}`,
    }
  }

  protected brainInjectionIdentity(loaded: LoadedAutomationRunContext) {
    return {
      workspaceId: loaded.run.workspaceId,
      userId: loaded.agent.ownerUserId,
    }
  }

  /**
   * Automation output lives in `resultJson.output`; fall back to the run error
   * so a failed automation still writes its stated reason to workspace memory.
   */
  protected override async readWorkflowTurnSummary(runId: string): Promise<{
    workspaceId: string | null
    ownerUserId: string | null
    summary: string
  }> {
    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await this.getDb()
          .select({
            workspaceId: schema.automationRun.workspaceId,
            ownerUserId: schema.agent.ownerUserId,
            resultJson: schema.automationRun.resultJson,
            error: schema.automationRun.error,
          })
          .from(schema.automationRun)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.automationRun.agentId),
          )
          .where(eq(schema.automationRun.id, runId))
          .limit(1)
        if (!row) return { workspaceId: null, ownerUserId: null, summary: '' }
        const output = objectOrNull(row.resultJson)?.output
        const rawSummary =
          typeof output === 'string'
            ? output
            : output !== undefined
              ? JSON.stringify(output)
              : ''
        const summary = rawSummary.trim()
        return {
          workspaceId: row.workspaceId,
          ownerUserId: row.ownerUserId,
          summary: summary !== '' ? summary : (row.error ?? '').trim(),
        }
      },
      catch: (cause) => this.dbError('read automation run summary', cause),
    })
    if (result.isErr()) {
      return { workspaceId: null, ownerUserId: null, summary: '' }
    }
    return result.value
  }

  protected runLogFields() {
    return { ...this.currentLogContext }
  }

  protected override async onTurnStarted(runId: string) {
    await this.recordTrace(runId, {
      ts: new Date().toISOString(),
      kind: 'turn_started',
    })
  }

  protected override async onRunStepFinished(
    runId: string,
    ctx: StepContext,
    usage: RunUsageSnapshot,
  ) {
    await this.recordTrace(runId, {
      ts: new Date().toISOString(),
      kind: 'step_finished',
      finishReason: ctx.finishReason,
      textPreview:
        typeof ctx.text === 'string' ? previewString(ctx.text) : undefined,
      usage,
    })
  }

  protected turnStopConditions() {
    return AUTOMATION_RUN_TERMINAL_TOOL_STOP_CONDITIONS
  }

  protected turnPrompt(mode: RunTurnMode) {
    return mode === 'resume'
      ? 'Resume this automation run using the injected automation context. Complete required work, then call complete_automation with the final result.'
      : 'Start this automation run using the injected automation context. Complete the task directly, then call complete_automation. Respect the injected closure controls: do not create issues, update GitHub, draft PRs, update QA artifacts, or mutate source unless the run payload explicitly enables that closure action.'
  }

  protected turnMetadata(mode: RunTurnMode, input: RunTurnInput) {
    return {
      kind: 'automation',
      mode,
      runId: input.runId,
      turn: input.turn,
    }
  }

  /**
   * Gives standalone automations the same first-party web research surface as
   * chat and issue runs. Exa previously reached automations through the public
   * MCP connector; removing that connector without adding these tools left the
   * built-in Daily news digest unable to perform its primary task.
   */
  override getTools(): ToolSet {
    return {
      execute: createExecuteTool({
        ctx: this.ctx,
        tools: {},
        state: createWorkspaceStateBackend(this.workspace),
        loader: this.env.LOADER,
      }),
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
      ...createWebTools({
        env: this.env.EXA_API_KEY ? { EXA_API_KEY: this.env.EXA_API_KEY } : {},
        sql: (query, ...params) =>
          this.ctx.storage.sql.exec(query, ...(params as WebToolsSqlValue[])),
      }),
      ...createBrainTools({
        env: {
          ...(this.env.HELIX_URL === undefined
            ? {}
            : { HELIX_URL: this.env.HELIX_URL }),
          ...(this.env.HELIX_API_KEY === undefined
            ? {}
            : { HELIX_API_KEY: this.env.HELIX_API_KEY }),
        },
        ai: this.env.AI,
        files: this.env.BRAIN_FILES,
        getContext: () => {
          const ctx = this.currentLogContext
          if (ctx === null) return null
          const { workspaceId, agentId, runId } = ctx
          if (
            typeof workspaceId !== 'string' ||
            typeof agentId !== 'string' ||
            typeof runId !== 'string'
          ) {
            return null
          }
          return {
            workspaceId,
            agentId,
            runId,
          }
        },
      }),
      ...createBrowserTools({
        browser: this.env.BROWSER,
        loader: this.env.LOADER,
      }),
    }
  }

  override async beforeToolCall(ctx: ToolCallContext) {
    const activeResult = await this.assertRunActiveForTool()
    if (activeResult.isErr()) throw activeResult.error

    const gateResult = this.assertToolAllowed(ctx.toolName)
    if (gateResult.isErr()) throw gateResult.error

    this.aiObservation.beforeToolCall(ctx)
    automationRunLogger.info('automation_run.tool.started', {
      ...this.currentLogContext,
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
      step: ctx.stepNumber,
    })

    await this.recordTrace(this.currentRunId, {
      ts: new Date().toISOString(),
      kind: 'tool_started',
      step: ctx.stepNumber,
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
      inputPreview: previewUnknown(ctx.input),
    })

    return undefined
  }

  override async afterToolCall(ctx: ToolCallResultContext) {
    const runId = this.currentRunId
    if (!runId) return

    automationRunLogger[ctx.success ? 'info' : 'warn'](
      'automation_run.tool.finished',
      {
        ...this.currentLogContext,
        toolName: ctx.toolName,
        toolCallId: ctx.toolCallId,
        durationMs: ctx.durationMs,
        ok: ctx.success,
        error: ctx.success ? undefined : errorMessage(ctx.error),
      },
    )

    await this.recordTrace(runId, {
      ts: new Date().toISOString(),
      kind: 'tool_finished',
      step: ctx.stepNumber,
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
      durationMs: ctx.durationMs,
      ok: ctx.success,
      outputPreview: ctx.success ? previewUnknown(ctx.output) : undefined,
      error: ctx.success ? undefined : errorMessage(ctx.error),
    })
    this.aiObservation.afterToolCall(ctx)
  }

  /**
   * Automation finish policy: a run that ended without calling
   * complete_automation is completed from the assistant's final text, or
   * failed when there is none.
   */
  protected async finishSettledTurn(runId: string, result: ChatResponseResult) {
    const statusResult = await this.readRunStatus(runId)
    if (
      statusResult.isOk() &&
      isTerminalAutomationRunStatus(statusResult.value)
    ) {
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
        this.logRunWarning('close_failed', {
          runId,
          reason: 'automation_completed_without_output',
          ...errorFields(failedResult.error),
        })
      }
      return
    }

    const completeResult = await this.finishCompleted(runId, {
      output,
      data: null,
      source: 'assistant',
    })
    if (completeResult.isErr()) {
      this.logRunWarning('complete_failed', {
        runId,
        ...errorFields(completeResult.error),
      })
    }
  }

  protected override assertToolAllowed(
    runtimeToolName: string,
  ): ResultValue<void, RunSubAgentError> {
    if (runtimeToolName === 'complete_automation') return Result.ok()

    if (runtimeToolName.startsWith('browser_') && !this.currentBrowserAllowed) {
      return Result.err(
        new AutomationRunSubAgentError({
          code: 'runtime_failed',
          message:
            'Browser Run tools are only available to automations whose execution_config enables capabilities.browser.',
        }),
      )
    }

    // Closure controls are per-run limits, separate from what the agent may do
    // in general, so they apply to full-access agents too.
    const closureResult = this.assertClosureToolAllowed(
      connectorToolForName(runtimeToolName),
    )
    if (closureResult.isErr()) return closureResult

    return super.assertToolAllowed(runtimeToolName)
  }

  /**
   * Enforces report-only QA defaults for external and source-mutating tools.
   *
   * Connector permissions answer "can this agent ever call the tool?"; this
   * guard answers "did this specific automation run opt into closure work?".
   * It prevents accidental GitHub issue/PR/file writes when a QA sweep only
   * requested evidence and recommendations.
   */
  private assertClosureToolAllowed(
    connectorTool: ReturnType<typeof connectorToolForName>,
  ): ResultValue<void, RunSubAgentError> {
    const controls = this.currentClosureControls
    if (!controls || !connectorTool || connectorTool.connectorId !== 'github') {
      return Result.ok()
    }

    const github = connectorRegistry.find(
      (connector) => connector.id === 'github',
    )
    const meta = github?.tools?.[connectorTool.toolName]
    if (!meta || meta.riskClass === 'read') return Result.ok()

    const action = controls.closureAction
    const toolName = connectorTool.toolName
    const issueWriteAllowed =
      action === 'github-issue' &&
      ['add_issue_comment', 'issue_write'].includes(toolName)
    const sourceWriteAllowed =
      controls.allowSourceMutation &&
      ((action === 'draft-pr' &&
        [
          'create_branch',
          'create_or_update_file',
          'create_pull_request',
          'fork_repository',
          'push_files',
          'update_pull_request',
          'update_pull_request_branch',
        ].includes(toolName)) ||
        (action === 'qa-artifact-update' &&
          ['create_branch', 'create_or_update_file', 'push_files'].includes(
            toolName,
          )))

    if (issueWriteAllowed || sourceWriteAllowed) return Result.ok()

    return Result.err(
      new AutomationRunSubAgentError({
        code: 'runtime_failed',
        message: `Tool ${toolName} is blocked by automation closure controls (${action}).`,
      }),
    )
  }

  private async assertRunActiveForTool(): Promise<
    ResultValue<void, RunSubAgentError>
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

  protected async loadTurnContext(
    runId: string,
  ): Promise<ResultValue<LoadedAutomationRunContext, RunSubAgentError>> {
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
      catch: (cause) => this.dbError('load automation turn context', cause),
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
    const closureControls = this.readClosureControls(
      input.run,
      input.automation,
    )

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
      ...(closureControls
        ? [
            [
              '## Closure controls',
              JSON.stringify(closureControls, null, 2),
              '',
              'Default is report-only. If closureAction is report-only, do not create Garden issues, write GitHub issues, draft pull requests, update QA artifacts, or mutate repository files. GitHub and source-writing tools are runtime-blocked unless this payload opts in.',
            ].join('\n'),
          ]
        : []),
      ['## Recent automation runs', JSON.stringify(recentRuns, null, 2)].join(
        '\n',
      ),
      ['## Available agents', JSON.stringify(availableAgents, null, 2)].join(
        '\n',
      ),
    ].join('\n\n')
  }

  private captureRunProduct(
    loaded: LoadedAutomationRunContext,
    event: GardenAnalyticsEventName,
    properties: Record<string, unknown>,
  ) {
    this.aiObservation.captureProductFor(
      {
        runtimeKind: 'automation_run',
        distinctId: loaded.agent.ownerUserId,
        workspaceId: loaded.run.workspaceId,
        agentId: loaded.run.agentId,
        automationId: loaded.run.automationId,
        runId: loaded.run.id,
        traceId: loaded.run.id,
        sessionId: `automation-run:${loaded.run.id}`,
      },
      event,
      properties,
    )
  }

  /**
   * Reads per-run QA closure controls from the trigger payload, or null when
   * the automation is not a QA sweep (other automations have no closure limits).
   *
   * Why this exists: QA automations default to report-only, but users may
   * intentionally ask a run to create a GitHub issue, draft a PR, or update QA
   * artifacts. Encoding that as typed payload state lets prompts and runtime
   * tool gates agree on the mutation boundary instead of trusting prose alone.
   */
  private readClosureControls(
    run: typeof schema.automationRun.$inferSelect,
    automation: typeof schema.automation.$inferSelect,
  ): QaSweepClosureControls | null {
    if (!isQaSweepAutomation(automation)) return null
    const context = run.contextSnapshot as AutomationRunContextSnapshot | null
    const parsed = parseQaSweepRunPayload(context?.payload ?? null)
    if (!parsed.success) {
      return {
        closureAction: 'report-only' as const,
        allowSourceMutation: false,
      }
    }
    return parsed.data
  }

  private applyClosureControls(loaded: LoadedAutomationRunContext) {
    this.currentClosureControls = this.readClosureControls(
      loaded.run,
      loaded.automation,
    )
  }

  protected async markRunStarted(
    loaded: LoadedAutomationRunContext,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () => {
        const [startedRun] = await this.getDb()
          .update(schema.automationRun)
          .set({
            status: 'running',
            startedAt: loaded.run.startedAt ?? now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.automationRun.id, loaded.run.id),
              eq(schema.automationRun.status, 'queued'),
            ),
          )
          .returning({ id: schema.automationRun.id })
        return Boolean(startedRun)
      },
      catch: (cause) => this.dbError('mark automation run started', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    if (result.value) {
      this.captureRunProduct(
        loaded,
        GARDEN_ANALYTICS_EVENTS.automationRunStarted,
        {
          source: loaded.run.source,
          started_at: (loaded.run.startedAt ?? now).toISOString(),
        },
      )
    }
    return Result.ok()
  }

  protected async markRunResumed(
    loaded: LoadedAutomationRunContext,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(schema.automationRun)
          .set({ status: 'running', updatedAt: now })
          .where(eq(schema.automationRun.id, loaded.run.id))
      },
      catch: (cause) => this.dbError('mark automation run resumed', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok()
  }

  /**
   * Persists a compact automation trace into result_json while a run is active.
   * Cloudflare Think already saves chat messages and emits telemetry, but the
   * automation detail page needs a simple run-local timeline for QA evals: tool
   * starts/finishes, step summaries, usage snapshots, and terminal status.
   * The trace is intentionally lossy to avoid storing huge tool outputs or
   * secrets; full connector/tool audits remain in `tool_call_audit`.
   * References consulted: Cloudflare Agents Think lifecycle hooks and AI SDK
   * onStepFinish/tool-call docs.
   */
  private async recordTrace(runId: string | null, event: AutomationTraceEvent) {
    if (!runId) return
    const nextTrace = [...this.currentTrace, event].slice(-80)
    this.currentTrace = nextTrace

    const db = this.getDb()
    const result = await Result.tryPromise({
      try: async () => {
        const [row] = await db
          .select({ resultJson: schema.automationRun.resultJson })
          .from(schema.automationRun)
          .where(eq(schema.automationRun.id, runId))
          .limit(1)
        const existing = objectOrNull(row?.resultJson) ?? {}
        await db
          .update(schema.automationRun)
          .set({
            resultJson: {
              ...existing,
              observability: {
                trace: nextTrace,
                traceUpdatedAt: event.ts,
              },
            },
            updatedAt: new Date(),
          })
          .where(eq(schema.automationRun.id, runId))
      },
      catch: (cause) => this.dbError('persist automation trace', cause),
    })

    if (result.isErr()) {
      this.logRunWarning('trace_persist_failed', {
        runId,
        ...errorFields(result.error),
      })
    }
  }

  protected async setCancelRequested(
    runId: string,
    reason: string,
  ): Promise<ResultValue<void, RunSubAgentError>> {
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
      catch: (cause) =>
        this.dbError('request automation run cancellation', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    return Result.ok()
  }

  private async finishCompleted(
    runId: string,
    completion: {
      output: string
      data: unknown
      source: 'assistant' | 'complete_automation'
    },
  ): Promise<ResultValue<void, RunSubAgentError>> {
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
    await this.recordTrace(runId, {
      ts: now.toISOString(),
      kind: 'run_completed',
      textPreview: previewString(output),
    })
    const trace = this.currentTrace

    const result = await Result.tryPromise({
      try: async () =>
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
            return false
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
                observability: {
                  trace,
                  traceUpdatedAt: now.toISOString(),
                },
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
          return true
        }),
      catch: (cause) => this.dbError('finish automation run', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    if (result.value) {
      this.aiObservation.captureProduct(
        GARDEN_ANALYTICS_EVENTS.automationRunCompleted,
        {
          output,
          completion_source: completion.source,
          completed_at: now.toISOString(),
        },
      )
    }
    return Result.ok()
  }

  protected async finishCancelledRun(
    runId: string,
    reason: string,
    loaded?: LoadedAutomationRunContext,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    const db = this.getDb()
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () =>
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
            return false
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
          return true
        }),
      catch: (cause) => this.dbError('cancel automation run', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    if (result.value) {
      const properties = { reason, completed_at: now.toISOString() }
      if (loaded) {
        this.captureRunProduct(
          loaded,
          GARDEN_ANALYTICS_EVENTS.automationRunCancelled,
          properties,
        )
      } else {
        this.aiObservation.captureProduct(
          GARDEN_ANALYTICS_EVENTS.automationRunCancelled,
          properties,
        )
      }
    }
    return Result.ok()
  }

  protected async forceCloseFailed(
    runId: string,
    reason: string,
    loaded?: LoadedAutomationRunContext,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    const db = this.getDb()
    const now = new Date()
    await this.recordTrace(runId, {
      ts: now.toISOString(),
      kind: 'run_failed',
      error: reason,
    })
    const trace = this.currentTrace

    const writeResult = await Result.tryPromise({
      try: async () =>
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
            return false
          }

          await tx
            .update(schema.automationRun)
            .set({
              status: 'failed',
              error: reason,
              resultJson: {
                resolution: 'failed',
                reason,
                observability: {
                  trace,
                  traceUpdatedAt: now.toISOString(),
                },
              },
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
          return true
        }),
      catch: (cause) =>
        this.dbError('force close failed automation run', cause),
    })
    if (writeResult.isErr()) return Result.err(writeResult.error)
    if (writeResult.value) {
      const properties = { reason, completed_at: now.toISOString() }
      if (loaded) {
        this.captureRunProduct(
          loaded,
          GARDEN_ANALYTICS_EVENTS.automationRunFailed,
          properties,
        )
      } else {
        this.aiObservation.captureProduct(
          GARDEN_ANALYTICS_EVENTS.automationRunFailed,
          properties,
        )
      }
    }
    return Result.ok()
  }

  protected override clearTurnState() {
    super.clearTurnState()
    this.currentBrowserAllowed = false
    this.currentLogContext = null
    this.currentTrace = []
  }

  protected async resolveMcpIdentity(): Promise<
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
}
