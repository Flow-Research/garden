import {
  AgentWorkflow,
  type AgentWorkflowEvent,
  type AgentWorkflowStep,
} from 'agents/workflows'
import { TaggedError } from 'better-result'
import { disposeRpcResult } from '@garden/app-state/platform/rpc'
import { createGardenLogger } from '@garden/observability/logger'
import type { AgentDO } from './agent-do'

/**
 * Per-run durable executor.
 *
 * One Workflow instance per issue or automation run, keyed by `runId`. The
 * Workflow drives the agent loop turn-by-turn through the originating AgentDO;
 * streaming and live UI stay in the DO, durable checkpoints live here.
 *
 * Cloudflare's `AgentWorkflow` now owns the originating-agent binding/name
 * injection, workflow tracking callbacks, and typed `this.agent` RPC. Garden
 * keeps only the product ledger state machine (`issue_run`/`automation_run`)
 * and the turn/wait loop. References: Cloudflare Agents Run Workflows docs,
 * installed `agents/dist/workflows.js`, and docs/features/agent-runtime-rearchitecture.md.
 */
export type RunWorkflowParams =
  | {
      kind: 'issue'
      runId: string
      issueId: string
    }
  | {
      kind: 'automation'
      runId: string
    }

export type RunWorkflowBinding = Workflow<RunWorkflowParams>

export class RunWorkflowCreateError extends TaggedError(
  'RunWorkflowCreateError',
)<{
  code: 'workflow_unavailable' | 'create_failed'
  message: string
  cause?: unknown
}>() {}

export type RunWorkflowEnv = Cloudflare.Env & {
  AgentDO: DurableObjectNamespace<AgentDO>
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
const MAX_TURNS = 200
const workflowLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'run-workflow',
})

const TERMINAL_SUBMISSION_STATUSES = new Set([
  'completed',
  'aborted',
  'skipped',
  'error',
])

export type RunWorkflowTurnStartResult =
  | { kind: 'run_status'; status: string }
  | { kind: 'submitted'; submissionId: string; submissionStatus: string }

export type RunWorkflowTurnCompleteEvent = {
  error?: string
  status: string
  submissionId: string
}

export const RUN_WORKFLOW_TURN_COMPLETE_EVENT_PREFIX =
  'run-turn-complete' as const

export function getRunWorkflowTurnCompleteEventType(submissionId: string) {
  return `${RUN_WORKFLOW_TURN_COMPLETE_EVENT_PREFIX}:${submissionId}`
}

function isTerminalSubmissionStatus(status: string) {
  return TERMINAL_SUBMISSION_STATUSES.has(status)
}

export class RunWorkflow extends AgentWorkflow<
  AgentDO,
  RunWorkflowParams,
  { runId: string; status: string },
  RunWorkflowEnv
> {
  override async run(
    event: AgentWorkflowEvent<RunWorkflowParams>,
    step: AgentWorkflowStep,
  ): Promise<{ runId: string; status: string }> {
    const { runId } = event.payload
    workflowLogger.info('run_workflow.started', {
      kind: event.payload.kind,
      runId,
      ...(event.payload.kind === 'issue'
        ? { issueId: event.payload.issueId }
        : {}),
    })

    let mode: 'start' | 'resume' = 'start'

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const started = await step.do<RunWorkflowTurnStartResult>(
        `turn-${turn}-submit`,
        { retries: TURN_RETRIES },
        async () => {
          const turnResult =
            event.payload.kind === 'automation'
              ? disposeRpcResult(
                  await this.agent.executeAutomationRunTurn({
                    runId,
                    mode,
                    turn,
                  }),
                )
              : disposeRpcResult(
                  await this.agent.executeRunTurn({
                    runId,
                    issueId: event.payload.issueId,
                    mode,
                    turn,
                  }),
                )

          return turnResult.kind === 'run_status'
            ? { kind: 'run_status', status: turnResult.status }
            : {
                kind: 'submitted',
                submissionId: turnResult.submissionId,
                submissionStatus: turnResult.submissionStatus,
              }
        },
      )

      const result =
        started.kind === 'run_status'
          ? { status: started.status }
          : await this.waitForSubmittedTurnCompletion({
              event,
              runId,
              started,
              step,
              turn,
            })

      if (TERMINAL_RUN_STATUSES.has(result.status)) {
        workflowLogger.info('run_workflow.completed', {
          kind: event.payload.kind,
          runId,
          turn,
          status: result.status,
          ...(event.payload.kind === 'issue'
            ? { issueId: event.payload.issueId }
            : {}),
        })
        await step.reportComplete({ runId, status: result.status })
        return { runId, status: result.status }
      }

      if (!AWAITING_RUN_STATUSES.has(result.status)) {
        workflowLogger.info('run_workflow.completed', {
          kind: event.payload.kind,
          runId,
          turn,
          status: result.status,
          ...(event.payload.kind === 'issue'
            ? { issueId: event.payload.issueId }
            : {}),
        })
        await step.reportComplete({ runId, status: result.status })
        return { runId, status: result.status }
      }

      const resumed = await step
        .waitForEvent<{ kind: 'resume' | 'cancel' }>(`resume-${turn}`, {
          type: RUN_WORKFLOW_CONTROL_EVENT_TYPE,
        })
        .catch(() => null)

      if (!resumed || resumed.payload.kind === 'cancel') {
        await step.do(
          `cancel-${turn}`,
          { retries: { limit: 2, delay: '2 seconds', backoff: 'constant' } },
          async () => {
            if (event.payload.kind === 'automation') {
              return await this.agent.cancelAutomationRun({ runId })
            }
            return await this.agent.cancelIssueRun({
              runId,
              issueId: event.payload.issueId,
            })
          },
        )
        workflowLogger.warn('run_workflow.cancelled', {
          kind: event.payload.kind,
          runId,
          turn,
          ...(event.payload.kind === 'issue'
            ? { issueId: event.payload.issueId }
            : {}),
        })
        await step.reportComplete({ runId, status: 'cancelled' })
        return { runId, status: 'cancelled' }
      }

      mode = 'resume'
    }

    workflowLogger.warn('run_workflow.max_turns_exceeded', {
      kind: event.payload.kind,
      runId,
      ...(event.payload.kind === 'issue'
        ? { issueId: event.payload.issueId }
        : {}),
    })
    await step.reportComplete({ runId, status: 'max_turns_exceeded' })
    return { runId, status: 'max_turns_exceeded' }
  }

  /**
   * Bridges Think's durable submission ledger into Workflow durability without
   * DO-local timers. The Workflow submits exactly once via `step.do`, then waits
   * on the SDK Workflow event emitted by `Think.onSubmissionStatus`; replayed
   * Workflow steps skip the wait when `submitMessages()` reports an already
   * terminal submission. This replaces the former in-memory waiter/timeout path
   * that could fail long-running turns even though the SDK could keep working.
   */
  private async waitForSubmittedTurnCompletion(input: {
    event: AgentWorkflowEvent<RunWorkflowParams>
    runId: string
    started: Extract<RunWorkflowTurnStartResult, { kind: 'submitted' }>
    step: AgentWorkflowStep
    turn: number
  }): Promise<{ status: string }> {
    if (!isTerminalSubmissionStatus(input.started.submissionStatus)) {
      await input.step.waitForEvent<RunWorkflowTurnCompleteEvent>(
        `turn-${input.turn}-complete-event`,
        {
          type: getRunWorkflowTurnCompleteEventType(input.started.submissionId),
        },
      )
    }

    return await input.step.do<{ status: string }>(
      `turn-${input.turn}-complete-status`,
      { retries: TURN_RETRIES },
      async () => {
        const completion =
          input.event.payload.kind === 'automation'
            ? disposeRpcResult(
                await this.agent.completeAutomationRunTurn({
                  runId: input.runId,
                  submissionId: input.started.submissionId,
                }),
              )
            : disposeRpcResult(
                await this.agent.completeRunTurn({
                  runId: input.runId,
                  issueId: input.event.payload.issueId,
                  submissionId: input.started.submissionId,
                }),
              )
        return { status: completion.status }
      },
    )
  }
}

export type RunWorkflowControlEvent = { kind: 'resume' | 'cancel' }
export const RUN_WORKFLOW_CONTROL_EVENT_TYPE = 'run-control' as const
