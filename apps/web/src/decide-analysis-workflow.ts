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
import type {
  DecideAnalysisWorkflowParams,
  AgentDO,
} from '@garden/agent-runtime'
import { createGardenLogger } from '@garden/observability/logger'
import type { AppEnv } from '@/lib/server/env'
import {
  callDirectDecideTool,
  type DirectDecideCallOptions,
} from '@/lib/server/executor-engine/direct-decide-mcp'
import { runExecutorForEnv } from '@/lib/server/executor-runtime'
import {
  claimDecideAnalysisRun,
  finishDecideAnalysis,
  markDecideAnalysisProviderStarted,
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

const providerSessionIdFromResult = (result: CallToolResult) => {
  const structured = result.structuredContent
  if (structured === null || typeof structured !== 'object') return null
  const value = (structured as Record<string, unknown>).session_id
  return typeof value === 'string' && value.length > 0 ? value : null
}

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
      { retries: { limit: 0, delay: '5 seconds' } },
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
            error: workflowFailure(
              'provider_error',
              providerErrorMessage(result),
            ),
          }
        }
        return {
          kind: 'result',
          resultJson: JSON.stringify(result) ?? '{}',
          providerSessionId: providerSessionIdFromResult(result),
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

    await step.do(
      `publish-${attempt}`,
      { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
      async () => {
        const agent = this.env.AgentDO.get(
          this.env.AgentDO.idFromName(event.payload.agentRuntimeName),
        )
        await agent.appendDecideAnalysisResult({
          threadId: event.payload.threadId,
          runId,
          attempt,
        })
      },
    )

    workflowLogger.info('decide_analysis_workflow.completed', {
      runId,
      attempt,
      status: finished.status,
    })
    return { runId, status: finished.status }
  }
}
