import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import { Result } from 'better-result'
import { Effect } from 'effect'
import type {
  CallToolResult,
  Progress,
} from '@modelcontextprotocol/sdk/types.js'
import {
  decideSessionIdFromResult,
  type DecideAnalysisWorkflowParams,
  type AgentDO,
} from '@garden/agent-runtime'
import { createGardenLogger } from '@garden/observability/logger'
import type { AppEnv } from '@/lib/server/env'
import {
  callDirectDecideTool,
  DECIDE_ANALYSIS_TIME_LIMIT_MS,
  isDecideTimeLimitResult,
  type DirectDecideCallOptions,
} from '@/lib/server/executor-engine/direct-decide-mcp'
import { runExecutorForEnv } from '@/lib/server/executor-runtime'
import {
  claimDecideAnalysisRun,
  finishDecideAnalysis,
  markDecideAnalysisProviderStarted,
  markDecideAnalysisDelivered,
  readDecideAnalysisForWorker,
  writeDecideAnalysisProgress,
} from '@/lib/server/decide-analysis/service'

type DecideAnalysisWorkflowEnv = AppEnv & {
  AgentDO: DurableObjectNamespace<AgentDO>
}

type WorkflowFailure = {
  code: string
  message: string
}

type ProviderExecution =
  | {
      kind: 'result'
      resultJson: string
      providerSessionId: string | null
    }
  | { kind: 'failed'; error: WorkflowFailure }
  | { kind: 'cancelled' }
  | { kind: 'uncertain'; error: WorkflowFailure }

const workflowLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'decide-analysis-workflow',
})

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause)

const providerErrorMessage = (result: CallToolResult) =>
  result.content
    .find(
      (
        block,
      ): block is Extract<(typeof result.content)[number], { type: 'text' }> =>
        block.type === 'text' && block.text.trim().length > 0,
    )
    ?.text.trim() ?? 'Decide returned a tool error without a message.'

const TIME_LIMIT_MESSAGE = `Decide did not finish within ${DECIDE_ANALYSIS_TIME_LIMIT_MS / 3_600_000} hour, so Garden stopped waiting. Ask a narrower question to retry.`

const workflowFailure = (code: string, message: string): WorkflowFailure => ({
  code,
  message,
})

const throwOnServiceError = <T>(result: Result<T, { message: string }>): T => {
  if (result.isErr()) throw new Error(result.error.message)
  return result.value
}

/**
 * Runs Decide outside the request lifecycle. The Workflow stores the provider
 * boundary before the call, persists progress independently, and commits one
 * terminal result. A replay after that boundary is marked uncertain instead
 * of silently charging Decide twice.
 */
export class DecideAnalysisWorkflow extends WorkflowEntrypoint<
  DecideAnalysisWorkflowEnv,
  DecideAnalysisWorkflowParams
> {
  override async run(
    event: WorkflowEvent<DecideAnalysisWorkflowParams>,
    step: WorkflowStep,
  ) {
    const { runId, attempt } = event.payload
    workflowLogger.info('decide_analysis_workflow.started', {
      runId,
      attempt,
    })

    const execution = await Result.tryPromise({
      try: () => this.runSteps(event, step),
      catch: (cause) => cause,
    })
    if (execution.isOk()) return execution.value

    const failure = workflowFailure(
      'workflow_failure',
      `Decide analysis workflow failed: ${errorMessage(execution.error)}`,
    )
    const finished = await step.do<{ status: string }>(
      `fail-${attempt}`,
      { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
      async () => {
        const snapshot = throwOnServiceError(
          await finishDecideAnalysis(this.env, {
            runId,
            attempt,
            error: failure,
          }),
        )
        return { status: snapshot?.status ?? 'stale' }
      },
    )
    workflowLogger.error('decide_analysis_workflow.failed', {
      runId,
      attempt,
      message: failure.message,
      status: finished.status,
    })
    return { runId, status: finished.status }
  }

  /**
   * Executes the durable analysis steps. The public `run` method wraps this
   * sequence so failures from any step become a persisted terminal failure
   * instead of leaving a claimed run in `running` state.
   */
  private async runSteps(
    event: WorkflowEvent<DecideAnalysisWorkflowParams>,
    step: WorkflowStep,
  ) {
    const { runId, attempt } = event.payload
    const claimed = await step.do<{ status: string }>(
      `claim-${attempt}`,
      { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
      async () => {
        const row = throwOnServiceError(
          await claimDecideAnalysisRun(this.env, { runId, attempt }),
        )
        if (row === null) throw new Error('Decide analysis run disappeared.')
        return { status: row.status }
      },
    )

    if (
      claimed.status === 'completed' ||
      claimed.status === 'failed' ||
      claimed.status === 'cancelled'
    ) {
      return { runId, status: claimed.status }
    }

    const execution = await step.do<ProviderExecution>(
      `provider-${attempt}`,
      {
        retries: { limit: 0, delay: '5 seconds' },
        // The 10-minute default step timeout would end the step before the
        // Decide request limit. One extra minute lets the request's own
        // timeout fire first and commit a clear failure instead.
        timeout: DECIDE_ANALYSIS_TIME_LIMIT_MS + 60_000,
      },
      async () => {
        const marker = throwOnServiceError(
          await markDecideAnalysisProviderStarted(this.env, {
            runId,
            attempt,
          }),
        )
        if (marker === null) throw new Error('Decide analysis run disappeared.')

        if (marker.kind === 'terminal') {
          return { kind: 'cancelled' }
        }
        if (marker.kind === 'cancel_requested') {
          return { kind: 'cancelled' }
        }
        if (marker.kind === 'uncertain') {
          return {
            kind: 'uncertain',
            error: workflowFailure(
              'provider_result_uncertain',
              'Decide may have received the analysis request before the Workflow resumed. Garden did not retry it automatically.',
            ),
          }
        }

        const row = throwOnServiceError(
          await readDecideAnalysisForWorker(this.env, { runId, attempt }),
        )
        if (row === null) throw new Error('Decide analysis run disappeared.')
        const providerInput = {
          question: row.question,
          ...(row.inputData === null ? {} : { data: row.inputData }),
          ...(row.context === null ? {} : { context: row.context }),
          ...(row.providerSessionId === null
            ? {}
            : { session_id: row.providerSessionId }),
        }
        let progressWrite: Promise<void> = Promise.resolve()
        const options: DirectDecideCallOptions = {
          timeoutMs: DECIDE_ANALYSIS_TIME_LIMIT_MS,
          onProgress: (progress: Progress) => {
            progressWrite = progressWrite.then(async () => {
              const saved = await writeDecideAnalysisProgress(this.env, {
                runId,
                attempt,
                progress: {
                  progress: progress.progress,
                  ...(progress.total === undefined
                    ? {}
                    : { total: progress.total }),
                  ...(progress.message === undefined
                    ? {}
                    : { message: progress.message }),
                },
              })
              if (saved.isErr()) {
                workflowLogger.warn(
                  'decide_analysis_workflow.progress_failed',
                  {
                    runId,
                    attempt,
                    message: saved.error.message,
                  },
                )
              }
            })
          },
        }
        const providerResult = await Result.tryPromise({
          try: () =>
            runExecutorForEnv<CallToolResult, never>(
              this.env,
              {
                tenant: row.workspaceId,
                subject: row.ownerUserId,
              },
              (executor) =>
                Effect.promise(() =>
                  callDirectDecideTool(
                    executor,
                    'analyze',
                    providerInput,
                    options,
                  ),
                ),
            ),
          catch: (cause) => cause,
        })
        await progressWrite

        if (providerResult.isErr()) {
          return {
            kind: 'failed',
            error: workflowFailure(
              'executor_failure',
              errorMessage(providerResult.error),
            ),
          }
        }

        const result = providerResult.value
        if (result.isError === true) {
          return {
            kind: 'failed',
            error: isDecideTimeLimitResult(result)
              ? workflowFailure('time_limit', TIME_LIMIT_MESSAGE)
              : workflowFailure('provider_error', providerErrorMessage(result)),
          }
        }
        return {
          kind: 'result',
          resultJson: JSON.stringify(result) ?? '{}',
          providerSessionId: decideSessionIdFromResult(result),
        }
      },
    )

    const finished = await step.do<{ status: string }>(
      `commit-${attempt}`,
      { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
      async () => {
        const input =
          execution.kind === 'result'
            ? {
                result: JSON.parse(execution.resultJson),
                providerSessionId: execution.providerSessionId,
              }
            : execution.kind === 'cancelled'
              ? {}
              : { error: execution.error }
        const snapshot = throwOnServiceError(
          await finishDecideAnalysis(this.env, {
            runId,
            attempt,
            ...input,
          }),
        )
        return { status: snapshot?.status ?? 'stale' }
      },
    )

    if (finished.status === 'stale') return { runId, status: 'stale' }
    if (finished.status === 'completed' || finished.status === 'failed') {
      await this.publish(event, step)
    }

    workflowLogger.info('decide_analysis_workflow.completed', {
      runId,
      attempt,
      status: finished.status,
    })
    return { runId, status: finished.status }
  }

  /**
   * Hands a completed or failed run to its chat, then records `delivered_at`.
   * The step uses the Workflow default retry policy; a replay is safe because
   * the chat submission is keyed by run and attempt. The run is already
   * terminal here, so a delivery that still fails after retries is logged as
   * its own event instead of escaping to `run`, which would otherwise rewrite
   * a finished analysis as a Workflow failure. Cancelled runs never reach
   * this step: the chat step already shows that outcome.
   */
  private async publish(
    event: WorkflowEvent<DecideAnalysisWorkflowParams>,
    step: WorkflowStep,
  ) {
    const { runId, attempt, threadId, agentRuntimeName } = event.payload
    const published = await Result.tryPromise({
      try: () =>
        step.do<{ delivered: boolean }>(`publish-${attempt}`, async () => {
          const agent = this.env.AgentDO.get(
            this.env.AgentDO.idFromName(agentRuntimeName),
          )
          const { delivered } = await agent.deliverDecideAnalysisResult({
            threadId,
            runId,
            attempt,
          })
          if (delivered) {
            throwOnServiceError(
              await markDecideAnalysisDelivered(this.env, { runId, attempt }),
            )
          }
          return { delivered }
        }),
      catch: (cause) => cause,
    })
    if (published.isErr()) {
      workflowLogger.error('decide_analysis_workflow.delivery_failed', {
        runId,
        attempt,
        message: errorMessage(published.error),
      })
    }
  }
}
