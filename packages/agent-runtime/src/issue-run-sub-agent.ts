import type {
  ChatResponseResult,
  ToolCallContext,
  ToolCallResultContext,
} from '@cloudflare/think'
import { hasToolCall, type ToolSet, type UIMessage } from 'ai'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { classifyConnectorError } from '@garden/core/connectors/errors'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import {
  GARDEN_ANALYTICS_EVENTS,
  type GardenAnalyticsEventName,
} from '@garden/observability/analytics/events'
import {
  derivePermissions,
  type AgentPermissions,
} from '@garden/core/agents/permissions'
import { formatIssueIdentifier } from '@garden/core/issues/identifier'
import {
  LIVE_RUN_STATUSES,
  isLiveIssueRunStatus,
  nextIssueStatusForRunStatus,
} from '@garden/core/issues/run-sync'
import type { IssueStatus } from '@garden/core/types/issue'
import type { IssueRunStatus } from '@garden/core/types/issue-run'
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
import { createReadAttachmentTool } from './agent-tools/read-attachment'
import { createReadSourceTool } from './agent-tools/read-source'
import { createReviseWorkProductTool } from './agent-tools/revise-work-product'
import { createUpdateIssueStatusTool } from './agent-tools/update-issue-status'
import {
  createUpdatePlanTool,
  readIssueRunPlan,
} from './agent-tools/update-plan'
import type { AiTurnIdentity } from './ai-observation'
import {
  RuntimeMcpError,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'
import { createChatSubAgentTools } from './chat-sub-agent-tools'
import { objectOrNull } from './runtime-utils'
import {
  RunSubAgentBase,
  RunTurnStopped,
  type RunSubAgentConfig,
  type RunSubAgentError,
  type RunSubAgentErrorFields,
  type RunTurnInput,
  type RunTurnMode,
} from './run-sub-agent-base'

type StartTurnInput = RunTurnInput & {
  issueId: string
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

const ISSUE_RUN_CONFIG: RunSubAgentConfig = {
  kind: 'issue',
  agentClass: 'IssueRunSubAgent',
  logger: issueRunLogger,
}

class IssueRunSubAgentError extends TaggedError(
  'IssueRunSubAgentError',
)<RunSubAgentErrorFields>() {}

function dateToIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
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

export class IssueRunSubAgent extends RunSubAgentBase<
  LoadedTurnContext,
  StartTurnInput
> {
  private currentRunState: IssueRunToolState | null = null
  private currentTriggerReason = ''
  private resolutionActions = new Set<IssueRunResolutionAction>()

  protected runConfig() {
    return ISSUE_RUN_CONFIG
  }

  protected runTable() {
    return schema.issueRun
  }

  protected runError(fields: RunSubAgentErrorFields) {
    return new IssueRunSubAgentError(fields)
  }

  protected runInstructionsContext() {
    return {
      key: 'issue-interaction',
      description:
        'Required issue-run behavior, tool rules, exit states, and output discipline.',
      get: async () => await loadIssueInteractionSkillMarkdown(),
    }
  }

  protected isActiveRunStatus(status: string) {
    return isLiveIssueRunStatus(status as IssueRunStatus)
  }

  protected activateRun(loaded: LoadedTurnContext) {
    this.currentRunState = loaded.runState
  }

  protected startTurnState() {
    this.resolutionActions.clear()
  }

  protected observationIdentity(
    loaded: LoadedTurnContext,
    runId: string,
  ): AiTurnIdentity {
    return {
      runtimeKind: 'issue_run',
      distinctId: loaded.runState.agentOwnerUserId,
      workspaceId: loaded.runState.workspaceId,
      agentId: loaded.runState.agentId,
      issueId: loaded.runState.issueId,
      runId,
      traceId: runId,
      sessionId: `issue-run:${runId}`,
    }
  }

  protected runLogFields() {
    const run = this.currentRunState
    if (!run) return null
    return {
      userId: run.agentOwnerUserId,
      workspaceId: run.workspaceId,
      agentId: run.agentId,
      issueId: run.issueId,
      runId: run.runId,
    }
  }

  protected override telemetryMetadata(runId: string) {
    return { ...super.telemetryMetadata(runId), issueId: this.name }
  }

  protected turnStopConditions() {
    return ISSUE_RUN_TERMINAL_TOOL_STOP_CONDITIONS
  }

  protected turnPrompt(mode: RunTurnMode) {
    return mode === 'resume'
      ? 'Resume this issue run using the latest issue context. If the user answered a pending question, use that answer now.'
      : 'Start this issue run using the injected issue context. Produce a useful work product, ask one focused question, mark blocked, or decompose into child issues.'
  }

  protected turnMetadata(mode: RunTurnMode, input: StartTurnInput) {
    return {
      kind: 'issue',
      issueId: input.issueId,
      mode,
      runId: input.runId,
      turn: input.turn,
    }
  }

  protected async finishCancelledRun(
    runId: string,
    reason: string,
    loaded?: LoadedTurnContext,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    if (loaded) return await this.finishCancelled(loaded.runState, reason)
    const runStateResult = await this.loadRunState(runId)
    if (runStateResult.isErr()) return Result.err(runStateResult.error)
    return await this.finishCancelled(runStateResult.value, reason)
  }

  override async onStart() {
    await loadIssueInteractionSkillMarkdown()
  }

  /**
   * Builds issue-run tools from live run state. Brain tools previously resolved
   * `this.name` as a chat thread; they now receive the issue run's authoritative
   * workspace, agent, and run ids from the same context as other issue tools.
   */
  override getTools(): ToolSet {
    const context = this.getIssueToolContext()
    return {
      ...createChatSubAgentTools({
        ctx: this.ctx,
        ...(this.env.EXA_API_KEY ? { exaApiKey: this.env.EXA_API_KEY } : {}),
        databaseUrl: this.env.HYPERDRIVE.connectionString,
        threadId: this.name,
        workspace: this.workspace,
        loader: this.env.LOADER,
        getSandbox: () => this.getAgentSandbox(),
        issueRunEnv: this.env,
        brain: {
          ...(this.env.HELIX_URL === undefined
            ? {}
            : { helixUrl: this.env.HELIX_URL }),
          ...(this.env.HELIX_API_KEY === undefined
            ? {}
            : { helixApiKey: this.env.HELIX_API_KEY }),
          ai: this.env.AI,
          files: this.env.BRAIN_FILES,
          getContext: () => {
            const run = this.currentRunState
            if (run === null) return null
            return {
              workspaceId: run.workspaceId,
              agentId: run.agentId,
              runId: run.runId,
            }
          },
        },
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
      read_attachment: createReadAttachmentTool(context),
      read_source: createReadSourceTool(context),
    }
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

    this.aiObservation.beforeToolCall(ctx)
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

    const db = getIssueRunDb(this.env.HYPERDRIVE.connectionString)
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
      this.logRunWarning('tool.event_append_failed', {
        runId: run.runId,
        toolName: ctx.toolName,
        eventType: 'issue_run:tool_started',
        ...errorFields(eventResult.error),
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
    const db = getIssueRunDb(this.env.HYPERDRIVE.connectionString)
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
      this.logRunWarning('tool.event_append_failed', {
        runId: run.runId,
        toolName: ctx.toolName,
        eventType: 'issue_run:tool_finished',
        ...errorFields(eventResult.error),
      })
    }
    this.aiObservation.afterToolCall(ctx)
  }

  /**
   * Issue finish policy: nudge once if the turn ended without a resolution,
   * close child-issue decompositions, and record completion analytics.
   */
  protected async finishSettledTurn(
    runId: string,
    _result: ChatResponseResult,
  ) {
    const guardResult = await this.enforceResolutionGuard(runId)
    if (guardResult.isErr()) {
      this.logRunWarning('resolution_guard_failed', {
        runId,
        ...errorFields(guardResult.error),
      })
    }

    const finalizeChildResult = await this.finalizeChildIssueResolution(runId)
    if (finalizeChildResult.isErr()) {
      this.logRunWarning('child_resolution_finalize_failed', {
        runId,
        ...errorFields(finalizeChildResult.error),
      })
    }

    const finalStatusResult = await this.readRunStatus(runId)
    if (finalStatusResult.isOk()) {
      const finalStatus = finalStatusResult.value
      if (finalStatus === 'succeeded') {
        this.aiObservation.captureProduct(
          GARDEN_ANALYTICS_EVENTS.issueRunCompleted,
          { status: finalStatus },
        )
      } else if (
        finalStatus === 'waiting_for_input' ||
        finalStatus === 'waiting_for_approval'
      ) {
        this.aiObservation.captureProduct(
          GARDEN_ANALYTICS_EVENTS.issueRunWaiting,
          { status: finalStatus },
        )
      }
    }
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

  private captureRunProduct(
    run: IssueRunToolState,
    event: GardenAnalyticsEventName,
    properties: Record<string, unknown>,
  ) {
    this.aiObservation.captureProductFor(
      {
        runtimeKind: 'issue_run',
        distinctId: run.agentOwnerUserId,
        workspaceId: run.workspaceId,
        agentId: run.agentId,
        issueId: run.issueId,
        runId: run.runId,
        traceId: run.runId,
        sessionId: `issue-run:${run.runId}`,
      },
      event,
      properties,
    )
  }

  private getIssueToolContext(): IssueRunToolContext {
    return {
      env: this.env,
      storageSql: this.ctx.storage.sql,
      getRunState: () => this.currentRunState,
      captureAnalytics: (event, properties) =>
        this.aiObservation.captureProduct(event, properties),
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

  private async assertRunActiveForTool(
    runId: string,
  ): Promise<ResultValue<void, RunSubAgentError>> {
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
        this.dbError('load issue run status before tool call', cause),
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

  private async loadRunState(
    runId: string,
  ): Promise<ResultValue<IssueRunToolState, RunSubAgentError>> {
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
      catch: (cause) => this.dbError('load issue run state', cause),
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

  protected async loadTurnContext(
    runId: string,
  ): Promise<ResultValue<LoadedTurnContext, RunSubAgentError>> {
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
      catch: (cause) => this.dbError('load issue turn context', cause),
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
      status: input.issue.status ?? 'todo',
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
      status: child.status ?? 'todo',
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

  protected async markRunStarted(
    loaded: LoadedTurnContext,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () =>
        await this.getDb().transaction(async (tx) => {
          const [startedRun] = await tx
            .update(schema.issueRun)
            .set({
              status: 'running',
              startedAt: loaded.run.startedAt ?? now,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.issueRun.id, loaded.run.id),
                eq(schema.issueRun.status, 'queued'),
              ),
            )
            .returning({ id: schema.issueRun.id })
          if (!startedRun) return false

          await tx
            .update(schema.issue)
            .set({
              status:
                nextIssueStatusForRunStatus(
                  'running',
                  (loaded.issue.status ?? 'todo') as IssueStatus,
                ) ?? loaded.issue.status,
              updatedAt: now,
            })
            .where(eq(schema.issue.id, loaded.runState.issueId))
          return true
        }),
      catch: (cause) => this.dbError('mark issue run started', cause),
    })
    if (result.isErr()) return Result.err(result.error)
    if (!result.value) return Result.ok()

    const db = getIssueRunDb(this.env.HYPERDRIVE.connectionString)
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

    this.captureRunProduct(
      loaded.runState,
      GARDEN_ANALYTICS_EVENTS.issueRunStarted,
      {
        trigger_source: loaded.run.triggerSource,
        started_at: (loaded.run.startedAt ?? now).toISOString(),
      },
    )
    return Result.ok()
  }

  protected async markRunResumed(
    loaded: LoadedTurnContext,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    const now = new Date()
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(schema.issueRun)
          .set({ status: 'running', updatedAt: now })
          .where(eq(schema.issueRun.id, loaded.run.id))
      },
      catch: (cause) => this.dbError('mark issue run resumed', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    const db = getIssueRunDb(this.env.HYPERDRIVE.connectionString)
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

  private async enforceResolutionGuard(
    runId: string,
  ): Promise<ResultValue<void, RunSubAgentError>> {
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
        if (saveResult.error instanceof RunTurnStopped) {
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
        if (continueResult.error instanceof RunTurnStopped) {
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
  ): Promise<ResultValue<void, RunSubAgentError>> {
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

    const db = getIssueRunDb(this.env.HYPERDRIVE.connectionString)
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

  protected async setCancelRequested(
    runId: string,
    reason: string,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    const result = await Result.tryPromise({
      try: async () => {
        await this.getDb()
          .update(schema.issueRun)
          .set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.issueRun.id, runId))
      },
      catch: (cause) => this.dbError('request issue run cancellation', cause),
    })
    if (result.isErr()) return Result.err(result.error)

    const runStateResult = await this.loadRunState(runId)
    if (runStateResult.isErr()) return Result.err(runStateResult.error)
    const db = getIssueRunDb(this.env.HYPERDRIVE.connectionString)
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

  private async finishCancelled(
    run: IssueRunToolState,
    reason: string,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    const now = new Date()
    const transitionResult = await Result.tryPromise({
      try: async () =>
        await this.getDb().transaction(async (tx) => {
          const [cancelledRun] = await tx
            .update(schema.issueRun)
            .set({
              status: 'cancelled',
              error: reason,
              resultJson: { resolution: 'cancelled', reason },
              finishedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.issueRun.id, run.runId),
                inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
              ),
            )
            .returning({ id: schema.issueRun.id })
          if (!cancelledRun) return false

          await tx
            .update(schema.issue)
            .set({ activeRunId: null, updatedAt: now })
            .where(eq(schema.issue.id, run.issueId))
          return true
        }),
      catch: (cause) => this.dbError('cancel issue run', cause),
    })
    if (transitionResult.isErr()) return Result.err(transitionResult.error)
    if (!transitionResult.value) return Result.ok()

    const eventResult = await appendIssueRunEvent({
      db: getIssueRunDb(this.env.HYPERDRIVE.connectionString),
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
    this.captureRunProduct(run, GARDEN_ANALYTICS_EVENTS.issueRunCancelled, {
      reason,
    })
    return Result.ok()
  }

  protected async forceCloseFailed(
    runId: string,
    reason: string,
  ): Promise<ResultValue<void, RunSubAgentError>> {
    const runStateResult = await this.loadRunState(runId)
    if (runStateResult.isErr()) return Result.err(runStateResult.error)

    const run = runStateResult.value
    const db = this.getDb()
    const now = new Date()

    const writeResult = await Result.tryPromise({
      try: async () =>
        await db.transaction(async (tx) => {
          const [failedRun] = await tx
            .update(schema.issueRun)
            .set({
              status: 'failed',
              error: reason,
              resultJson: { resolution: 'failed', reason },
              finishedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.issueRun.id, runId),
                inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
              ),
            )
            .returning({ id: schema.issueRun.id })
          if (!failedRun) return false

          await tx
            .update(schema.issue)
            .set({ activeRunId: null, updatedAt: now })
            .where(eq(schema.issue.id, run.issueId))
          return true
        }),
      catch: (cause) => this.dbError('force close failed issue run', cause),
    })
    if (writeResult.isErr()) return Result.err(writeResult.error)
    if (!writeResult.value) return Result.ok()

    const eventDb = getIssueRunDb(this.env.HYPERDRIVE.connectionString)
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

    this.captureRunProduct(run, GARDEN_ANALYTICS_EVENTS.issueRunFailed, {
      reason,
    })
    return Result.ok()
  }

  protected override clearTurnState() {
    super.clearTurnState()
    this.currentRunState = null
    this.currentTriggerReason = ''
    this.resolutionActions.clear()
  }

  protected async resolveMcpIdentity(): Promise<
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
    const result = await this.ensureMcpConnectionsLoaded('read-source')
    if (result.isOk()) return Result.ok(undefined)

    return Result.err(
      new IssueRunToolError({
        code: 'connector_failed',
        message: result.error,
        connectorError: classifyConnectorError(result.error),
      }),
    )
  }
}
