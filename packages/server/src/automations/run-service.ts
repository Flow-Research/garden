import { and, eq } from 'drizzle-orm'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from '@garden/db/schema'

const AGENT_RUNTIME_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/
const RUN_WORKFLOW_CONTROL_EVENT_TYPE = 'run-control'

type RunWorkflowControlEvent = { kind: 'resume' | 'cancel' }

type RunWorkflowBinding = {
  get: (id: string) => Promise<{
    sendEvent: (event: {
      type: typeof RUN_WORKFLOW_CONTROL_EVENT_TYPE
      payload: RunWorkflowControlEvent
    }) => Promise<void>
  }>
}

export type AutomationRunEnv = {
  DATABASE_URL: string
  RUN_WORKFLOW?: RunWorkflowBinding
  AgentDO?: {
    idFromName: (name: string) => any
    get: (id: any) => {
      startAutomationRunWorkflow: (input: { runId: string }) => Promise<void>
      cancelAutomationRun: (input: { runId: string }) => Promise<void>
    }
  }
}

export type StartAutomationRunInput = {
  workspaceId: string
  automationId: string
  triggerId?: string | null
  source: 'schedule' | 'manual' | 'webhook' | 'api'
  runId?: string
  agentId: string
  trigger?: {
    correlationId?: string
  }
  actor: { type: 'member' | 'agent' | 'system'; id: string }
  payload?: unknown
  contextSnapshot?: Record<string, unknown>
}

export type CancelAutomationRunInput = {
  workspaceId: string
  runId: string
  actor: { type: 'member' | 'agent' | 'system'; id: string }
  reason: string
}

export type StartAutomationRunOutcome = {
  kind: 'started'
  runId: string
}

export class AutomationRunServiceError extends TaggedError(
  'AutomationRunServiceError',
)<{
  code:
    | 'agent_not_found'
    | 'automation_not_found'
    | 'run_not_found'
    | 'runtime_error'
    | 'db_error'
  message: string
  cause?: unknown
}>() {}

function isAgentRuntimeName(value: string) {
  return AGENT_RUNTIME_NAME_PATTERN.test(value)
}

function serviceDbError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new AutomationRunServiceError({
    code: 'db_error',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

function runtimeError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new AutomationRunServiceError({
    code: 'runtime_error',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

function getDb(env: AutomationRunEnv) {
  return drizzle(env.DATABASE_URL, { schema })
}

function getAutomationAgentDoStub(
  env: AutomationRunEnv,
  agentRuntimeName: string,
): ResultValue<
  ReturnType<NonNullable<AutomationRunEnv['AgentDO']>['get']>,
  AutomationRunServiceError
> {
  if (!agentRuntimeName || !isAgentRuntimeName(agentRuntimeName)) {
    return Result.err(
      new AutomationRunServiceError({
        code: 'runtime_error',
        message: 'Agent runtime name is invalid.',
      }),
    )
  }

  if (!env.AgentDO) {
    return Result.err(
      new AutomationRunServiceError({
        code: 'runtime_error',
        message: 'AgentDO runtime binding is not configured.',
      }),
    )
  }

  return Result.ok(env.AgentDO.get(env.AgentDO.idFromName(agentRuntimeName)))
}

async function startAutomationRunRuntime(args: {
  env: AutomationRunEnv
  agentRuntimeName: string
  runId: string
}): Promise<ResultValue<void, AutomationRunServiceError>> {
  const stubResult = getAutomationAgentDoStub(args.env, args.agentRuntimeName)
  if (stubResult.isErr()) return Result.err(stubResult.error)

  const result = await Result.tryPromise({
    try: async () =>
      await stubResult.value.startAutomationRunWorkflow({ runId: args.runId }),
    catch: (cause) => runtimeError('start automation run workflow', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok()
}

async function sendAutomationWorkflowControlEvent(args: {
  env: AutomationRunEnv
  workflowInstanceId: string
  event: RunWorkflowControlEvent
  operation: string
}): Promise<ResultValue<void, AutomationRunServiceError>> {
  const workflow = args.env.RUN_WORKFLOW
  if (!workflow) {
    return Result.err(
      new AutomationRunServiceError({
        code: 'runtime_error',
        message: 'RUN_WORKFLOW binding is not configured.',
      }),
    )
  }

  const result = await Result.tryPromise({
    try: async () => {
      const instance = await workflow.get(args.workflowInstanceId)
      await instance.sendEvent({
        type: RUN_WORKFLOW_CONTROL_EVENT_TYPE,
        payload: args.event,
      })
    },
    catch: (cause) => runtimeError(args.operation, cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok()
}

async function abortRunningAutomationRuntime(args: {
  env: AutomationRunEnv
  agentRuntimeName: string
  runId: string
}): Promise<ResultValue<void, AutomationRunServiceError>> {
  const stubResult = getAutomationAgentDoStub(args.env, args.agentRuntimeName)
  if (stubResult.isErr()) return Result.err(stubResult.error)

  const result = await Result.tryPromise({
    try: async () =>
      await stubResult.value.cancelAutomationRun({ runId: args.runId }),
    catch: (cause) =>
      runtimeError('abort running automation run runtime', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok()
}

async function markAutomationStartFailed(args: {
  env: AutomationRunEnv
  runId: string
  error: AutomationRunServiceError
}): Promise<ResultValue<void, AutomationRunServiceError>> {
  const db = getDb(args.env)
  const now = new Date()
  const writeResult = await Result.tryPromise({
    try: async () => {
      await db
        .update(schema.automationRun)
        .set({
          status: 'failed',
          error: args.error.message,
          completedAt: now,
          failureReason: args.error.message,
          updatedAt: now,
        })
        .where(eq(schema.automationRun.id, args.runId))
    },
    catch: (cause) =>
      serviceDbError('mark automation workflow start failure', cause),
  })
  if (writeResult.isErr()) return Result.err(writeResult.error)
  return Result.ok()
}

export async function startAutomationRun(
  env: AutomationRunEnv,
  input: StartAutomationRunInput,
): Promise<ResultValue<StartAutomationRunOutcome, AutomationRunServiceError>> {
  const db = getDb(env)
  const lookupResult = await Result.tryPromise({
    try: async () => {
      const [automation] = await db
        .select({ id: schema.automation.id })
        .from(schema.automation)
        .where(
          and(
            eq(schema.automation.id, input.automationId),
            eq(schema.automation.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
      const [agent] = await db
        .select({
          id: schema.agent.id,
          workspaceId: schema.agent.workspaceId,
          hostName: schema.agent.hostName,
          status: schema.agent.status,
        })
        .from(schema.agent)
        .where(
          and(
            eq(schema.agent.id, input.agentId),
            eq(schema.agent.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
      return { automation: automation ?? null, agent: agent ?? null }
    },
    catch: (cause) => serviceDbError('load automation run inputs', cause),
  })
  if (lookupResult.isErr()) return Result.err(lookupResult.error)

  const { automation, agent } = lookupResult.value
  if (!automation) {
    return Result.err(
      new AutomationRunServiceError({
        code: 'automation_not_found',
        message: 'Automation not found.',
      }),
    )
  }
  if (!agent || agent.status === 'archived') {
    return Result.err(
      new AutomationRunServiceError({
        code: 'agent_not_found',
        message: 'Agent not found.',
      }),
    )
  }

  const agentRuntimeName = agent.hostName ?? agent.id
  const runId = input.runId ?? crypto.randomUUID()
  const now = new Date()
  const writeResult = await Result.tryPromise({
    try: async () => {
      await db.insert(schema.automationRun).values({
        id: runId,
        workspaceId: input.workspaceId,
        automationId: input.automationId,
        triggerId: input.triggerId ?? null,
        source: input.source,
        status: 'queued',
        agentId: input.agentId,
        hostName: agentRuntimeName,
        workflowInstanceId: runId,
        triggerPayload: input.payload ?? null,
        contextSnapshot: {
          kind: 'automation',
          source: input.source,
          trigger: input.trigger ?? {},
          actor: input.actor,
          payload: input.payload ?? null,
          ...input.contextSnapshot,
        },
        triggeredAt: now,
        updatedAt: now,
      })
    },
    catch: (cause) => serviceDbError('create automation run', cause),
  })
  if (writeResult.isErr()) return Result.err(writeResult.error)

  const startResult = await startAutomationRunRuntime({
    env,
    agentRuntimeName,
    runId,
  })
  if (startResult.isErr()) {
    const failedResult = await markAutomationStartFailed({
      env,
      runId,
      error: startResult.error,
    })
    if (failedResult.isErr()) return Result.err(failedResult.error)
    return Result.err(startResult.error)
  }

  return Result.ok({ kind: 'started', runId })
}

export async function cancelAutomationRun(
  env: AutomationRunEnv,
  input: CancelAutomationRunInput,
): Promise<ResultValue<void, AutomationRunServiceError>> {
  const db = getDb(env)
  const result = await Result.tryPromise({
    try: async () => {
      const [run] = await db
        .select()
        .from(schema.automationRun)
        .where(
          and(
            eq(schema.automationRun.id, input.runId),
            eq(schema.automationRun.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
      if (!run) return { kind: 'missing' as const }

      const previousStatus = run.status
      await db
        .update(schema.automationRun)
        .set({
          cancelRequestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.automationRun.id, input.runId))
      return {
        kind: 'cancelled' as const,
        agentRuntimeName: run.hostName,
        previousStatus,
        workflowInstanceId: run.workflowInstanceId,
      }
    },
    catch: (cause) => serviceDbError('cancel automation run', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  if (result.value.kind === 'missing') {
    return Result.err(
      new AutomationRunServiceError({
        code: 'run_not_found',
        message: 'Automation run not found.',
      }),
    )
  }

  const workflowResult = await sendAutomationWorkflowControlEvent({
    env,
    workflowInstanceId: result.value.workflowInstanceId ?? input.runId,
    event: { kind: 'cancel' },
    operation: 'cancel automation run workflow',
  })
  if (workflowResult.isErr()) return Result.err(workflowResult.error)

  if (result.value.previousStatus === 'running') {
    const abortResult = await abortRunningAutomationRuntime({
      env,
      agentRuntimeName: result.value.agentRuntimeName,
      runId: input.runId,
    })
    if (abortResult.isErr()) return Result.err(abortResult.error)
  }
  return Result.ok()
}
