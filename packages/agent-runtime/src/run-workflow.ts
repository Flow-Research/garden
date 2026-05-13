import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { disposeRpcResult } from '@garden/core/platform/rpc'

/**
 * Per-run durable executor.
 *
 * One Workflow instance per issue or automation run, keyed by `runId`. The
 * Workflow drives the agent loop turn-by-turn through AgentDO RPCs;
 * streaming and live UI stay in the DO, durable checkpoints live here.
 *
 * See:
 *   docs/features/agent-runtime-rearchitecture.md
 *   https://developers.cloudflare.com/agents/concepts/workflows/
 *   https://developers.cloudflare.com/workflows/
 */

export type RunWorkflowParams =
  | {
      kind: 'issue'
      runId: string
      agentRuntimeName: string
      issueId: string
    }
  | {
      kind: 'automation'
      runId: string
      agentRuntimeName: string
    }

export type RunWorkflowBinding = Workflow<RunWorkflowParams>

export class RunWorkflowCreateError extends TaggedError(
  'RunWorkflowCreateError',
)<{
  code: 'workflow_unavailable' | 'create_failed'
  message: string
  cause?: unknown
}>() {}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

const DUPLICATE_INSTANCE_PATTERNS = [
  'instance.already_exists',
  'already exists',
  'duplicate',
]

function isDuplicateWorkflowInstanceError(cause: unknown) {
  const message = errorMessage(cause).toLowerCase()
  return DUPLICATE_INSTANCE_PATTERNS.some((pattern) =>
    message.includes(pattern),
  )
}

export async function createRunWorkflow(
  workflow: RunWorkflowBinding | undefined,
  params: RunWorkflowParams,
): Promise<ResultValue<void, RunWorkflowCreateError>> {
  if (!workflow) {
    return Result.err(
      new RunWorkflowCreateError({
        code: 'workflow_unavailable',
        message: 'RUN_WORKFLOW binding is not configured.',
      }),
    )
  }

  const result = await Result.tryPromise({
    try: async () => {
      await workflow.create({
        id: params.runId,
        params,
      })
    },
    catch: (cause) => cause,
  })
  if (result.isOk() || isDuplicateWorkflowInstanceError(result.error)) {
    return Result.ok()
  }
  return Result.err(
    new RunWorkflowCreateError({
      code: 'create_failed',
      message: `create run workflow failed: ${errorMessage(result.error)}`,
      cause: result.error,
    }),
  )
}

type AgentDoStub = {
  executeRunTurn: (input: {
    runId: string
    issueId: string
    mode: 'start' | 'resume'
  }) => Promise<{ status: string }>
  cancelIssueRun: (input: { runId: string; issueId: string }) => Promise<void>
  executeAutomationRunTurn: (input: {
    runId: string
    mode: 'start' | 'resume'
  }) => Promise<{ status: string }>
  cancelAutomationRun: (input: { runId: string }) => Promise<void>
}

type AgentDoBinding = {
  idFromName: (name: string) => DurableObjectId
  get: (id: DurableObjectId) => AgentDoStub
}

export type RunWorkflowEnv = {
  AgentDO: AgentDoBinding
}

const TERMINAL_RUN_STATUSES = new Set([
  'succeeded',
  'completed',
  'failed',
  'cancelled',
  'blocked',
  'skipped',
])
const AWAITING_RUN_STATUSES = new Set([
  'waiting_for_input',
  'waiting_for_approval',
])

const TURN_RETRIES = {
  limit: 3,
  delay: '5 seconds' as const,
  backoff: 'exponential' as const,
}
const TURN_TIMEOUT = '10 minutes' as const
const RESUME_WAIT_TIMEOUT = '7 days' as const
const CANCEL_WAIT_TIMEOUT = '7 days' as const
const MAX_TURNS = 200

export class RunWorkflow extends WorkflowEntrypoint<
  RunWorkflowEnv,
  RunWorkflowParams
> {
  override async run(
    event: WorkflowEvent<RunWorkflowParams>,
    step: WorkflowStep,
  ): Promise<{ runId: string; status: string }> {
    const { runId, agentRuntimeName } = event.payload
    const stub = this.env.AgentDO.get(
      this.env.AgentDO.idFromName(agentRuntimeName),
    )

    let mode: 'start' | 'resume' = 'start'

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const result = await step.do(
        `turn-${turn}`,
        { retries: TURN_RETRIES, timeout: TURN_TIMEOUT },
        async () => {
          if (event.payload.kind === 'automation') {
            return disposeRpcResult(
              await stub.executeAutomationRunTurn({ runId, mode }),
            )
          }
          return disposeRpcResult(
            await stub.executeRunTurn({
              runId,
              issueId: event.payload.issueId,
              mode,
            }),
          )
        },
      )

      if (TERMINAL_RUN_STATUSES.has(result.status)) {
        return { runId, status: result.status }
      }

      if (!AWAITING_RUN_STATUSES.has(result.status)) {
        return { runId, status: result.status }
      }

      const resumed = await step
        .waitForEvent<{ kind: 'resume' | 'cancel' }>(`resume-${turn}`, {
          type: 'run-control',
          timeout: RESUME_WAIT_TIMEOUT,
        })
        .catch(() => null)

      if (!resumed || resumed.payload.kind === 'cancel') {
        await step.do(
          `cancel-${turn}`,
          { retries: { limit: 2, delay: '2 seconds', backoff: 'constant' } },
          async () => {
            if (event.payload.kind === 'automation') {
              return await stub.cancelAutomationRun({ runId })
            }
            return await stub.cancelIssueRun({
              runId,
              issueId: event.payload.issueId,
            })
          },
        )
        return { runId, status: 'cancelled' }
      }

      mode = 'resume'
    }

    return { runId, status: 'max_turns_exceeded' }
  }
}

export type RunWorkflowControlEvent = { kind: 'resume' | 'cancel' }
export const RUN_WORKFLOW_CONTROL_EVENT_TYPE = 'run-control' as const

void CANCEL_WAIT_TIMEOUT
