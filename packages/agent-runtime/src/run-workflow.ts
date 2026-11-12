import {
  AgentWorkflow,
  type AgentWorkflowEvent,
  type AgentWorkflowStep,
} from 'agents/workflows'
import { TaggedError } from 'better-result'
import { disposeRpcResult } from '@garden/app-state/platform/rpc'
import { createGardenLogger } from '@garden/observability/logger'
import type { AgentDO } from './agent-do'
import {
  DECIDE_ANALYSIS_OWNER_WAIT_MS,
  getDecideAnalysisFinishedEventType,
} from './decide-analysis-types'
import { waitForTurnToSettle } from './run-workflow-turn-wait'
import { isTerminalSubmissionStatus } from './runtime-utils'

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
 * installed `agents/dist/workflows.js`, and docs/concepts/architecture/run-engine.md.
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

export type RunWorkflowTurnStartResult =
  | { kind: 'run_status'; status: string }
  | { kind: 'submitted'; submissionId: string; submissionStatus: string }

/**
 * Something outside the agent loop a settled turn left the run waiting on.
 * An automation turn that starts a Decide analysis ends at once; the run
 * stays `running` and the Workflow, not the agent, waits for the analysis.
 * `settled` is true when Decide had already finished by the time the turn
 * was completed, so there is nothing left to wait for.
 */
export type RunWorkflowWait = {
  kind: 'decide_analysis'
  decideRunId: string
  settled: boolean
}

export type RunWorkflowTurnCompletion = {
  status: string
  waitingOn?: RunWorkflowWait
}

export type RunWorkflowTurnCompleteEvent = {
  error?: string
  status: string
  submissionId: string
}

export const RUN_WORKFLOW_TURN_COMPLETE_EVENT_PREFIX =
  'run-turn-complete' as const

/**
 * Builds the Workflow event type both `waitForEvent` and `sendEvent` use for a
 * turn. Cloudflare Workflows only accepts `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$` (max
 * 100 chars) for event types. Before: the type embedded the raw submission id
 * (`issue-run:<runId>:<turn>:<mode>`), so production `sendEvent` rejected it
 * and every turn waited out the status-check interval. Local miniflare skips
 * this validation, which hid the failure. After: each disallowed character is
 * mapped to `_`, so the type is valid and still unique per submission. Ref:
 * developers.cloudflare.com/workflows/build/events-and-parameters/.
 */
export function getRunWorkflowTurnCompleteEventType(submissionId: string) {
  return `${RUN_WORKFLOW_TURN_COMPLETE_EVENT_PREFIX}-${submissionId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
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
    let decideRunId: string | undefined

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
                    ...(decideRunId === undefined ? {} : { decideRunId }),
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

      const result: RunWorkflowTurnCompletion =
        started.kind === 'run_status'
          ? { status: started.status }
          : await this.waitForSubmittedTurnCompletion({
              event,
              runId,
              started,
              step,
              turn,
            })

      if (result.waitingOn?.kind === 'decide_analysis') {
        await this.waitForDecideAnalysis({
          runId,
          step,
          turn,
          wait: result.waitingOn,
        })
        mode = 'resume'
        decideRunId = result.waitingOn.decideRunId
        continue
      }
      decideRunId = undefined

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

      // A status that is neither terminal nor awaiting means the run row is
      // still live. Before, the Workflow completed here with `running` and
      // stranded the row (FLO-150); now the run is failed first, so the
      // instance never ends while its run looks in progress.
      if (!AWAITING_RUN_STATUSES.has(result.status)) {
        workflowLogger.error('run_workflow.ended_with_live_run', {
          kind: event.payload.kind,
          runId,
          turn,
          status: result.status,
          ...(event.payload.kind === 'issue'
            ? { issueId: event.payload.issueId }
            : {}),
        })
        const failed = await step.do<{ status: string }>(
          `turn-${turn}-live-run-failed`,
          { retries: TURN_RETRIES },
          async () => {
            const reason = 'workflow_ended_with_live_run'
            return event.payload.kind === 'automation'
              ? disposeRpcResult(
                  await this.agent.failAutomationRunTurn({ runId, reason }),
                )
              : disposeRpcResult(
                  await this.agent.failRunTurn({
                    runId,
                    issueId: event.payload.issueId,
                    reason,
                  }),
                )
          },
        )
        await step.reportComplete({ runId, status: failed.status })
        return { runId, status: failed.status }
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
   * Pauses an automation run while its Decide analysis works. Before, an
   * automation turn that called `decide_analyze` blocked on the MCP call
   * under the SDK's 60-second silence timeout. Now the turn ends as soon as
   * the analysis starts, and this wait is Workflow time, not turn time: the
   * Decide Workflow sends `decide-analysis-finished:<decideRunId>` to this
   * instance when the analysis is terminal, and cancelling the automation
   * run sends it too. It is the same `waitForEvent` bridge the turn-complete
   * wait uses, with no DO-local timer. The bound is
   * `DECIDE_ANALYSIS_OWNER_WAIT_MS`; a wait that times out still resumes the
   * agent, which reads the Decide run itself and reports that Garden stopped
   * waiting. References: workers-types `WorkflowStep.waitForEvent`
   * (`timeout` accepts milliseconds) and docs/proposals/decide-automations.md.
   */
  private async waitForDecideAnalysis(input: {
    runId: string
    step: AgentWorkflowStep
    turn: number
    wait: RunWorkflowWait
  }) {
    if (input.wait.settled) return
    const received = await input.step
      .waitForEvent(`turn-${input.turn}-decide-analysis`, {
        type: getDecideAnalysisFinishedEventType(input.wait.decideRunId),
        timeout: DECIDE_ANALYSIS_OWNER_WAIT_MS,
      })
      .then(
        () => true,
        () => false,
      )
    if (!received) {
      workflowLogger.warn('run_workflow.decide_analysis_wait_timed_out', {
        kind: 'automation',
        runId: input.runId,
        turn: input.turn,
        decideRunId: input.wait.decideRunId,
      })
    }
  }

  /**
   * Bridges Think's durable submission ledger into Workflow durability without
   * DO-local timers. The Workflow submits exactly once via `step.do`, then waits
   * on the SDK Workflow event emitted by `Think.onSubmissionStatus`; replayed
   * Workflow steps skip the wait when `submitMessages()` reports an already
   * terminal submission. This replaces the former in-memory waiter/timeout path
   * that could fail long-running turns even though the SDK could keep working.
   * When the event is lost, `waitForTurnToSettle` reconciles from Think's
   * submission state, and a turn that never settles fails the run.
   */
  private async waitForSubmittedTurnCompletion(input: {
    event: AgentWorkflowEvent<RunWorkflowParams>
    runId: string
    started: Extract<RunWorkflowTurnStartResult, { kind: 'submitted' }>
    step: AgentWorkflowStep
    turn: number
  }): Promise<RunWorkflowTurnCompletion> {
    const { payload } = input.event
    const submissionId = input.started.submissionId
    const logFields = {
      kind: payload.kind,
      runId: input.runId,
      turn: input.turn,
      submissionId,
      ...(payload.kind === 'issue' ? { issueId: payload.issueId } : {}),
    }

    if (!isTerminalSubmissionStatus(input.started.submissionStatus)) {
      const outcome = await waitForTurnToSettle({
        step: input.step,
        turn: input.turn,
        eventType: getRunWorkflowTurnCompleteEventType(submissionId),
        retries: TURN_RETRIES,
        readStatus: async () =>
          payload.kind === 'automation'
            ? disposeRpcResult(
                await this.agent.readAutomationRunTurnStatus({
                  runId: input.runId,
                  submissionId,
                }),
              )
            : disposeRpcResult(
                await this.agent.readRunTurnStatus({
                  runId: input.runId,
                  issueId: payload.issueId,
                  submissionId,
                }),
              ),
      })

      if (outcome === 'reconciled') {
        workflowLogger.warn('run_workflow.turn_event_missed', logFields)
      }
      if (outcome === 'timed_out') {
        workflowLogger.error('run_workflow.turn_timed_out', logFields)
        return await input.step.do<{ status: string }>(
          `turn-${input.turn}-timed-out`,
          { retries: TURN_RETRIES },
          async () => {
            const reason = 'turn_timed_out'
            const failed =
              payload.kind === 'automation'
                ? disposeRpcResult(
                    await this.agent.failAutomationRunTurn({
                      runId: input.runId,
                      reason,
                    }),
                  )
                : disposeRpcResult(
                    await this.agent.failRunTurn({
                      runId: input.runId,
                      issueId: payload.issueId,
                      reason,
                    }),
                  )
            return { status: failed.status }
          },
        )
      }
    }

    return await input.step.do<RunWorkflowTurnCompletion>(
      `turn-${input.turn}-complete-status`,
      { retries: TURN_RETRIES },
      async () => {
        const completion: RunWorkflowTurnCompletion =
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
        return completion.waitingOn === undefined
          ? { status: completion.status }
          : { status: completion.status, waitingOn: completion.waitingOn }
      },
    )
  }
}

export type RunWorkflowControlEvent = { kind: 'resume' | 'cancel' }
export const RUN_WORKFLOW_CONTROL_EVENT_TYPE = 'run-control' as const
