import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { Result } from 'better-result'
import {
  evalConfigurationSchema,
  trialIdentitySchema,
  trialReportSchema,
  type EvalConfiguration,
  type IssueRunStatus,
  type TaskDefinition,
  type TrialIdentity,
  type TrialReport,
} from '../index.ts'
import { createIssueRunEvidence } from '../evidence/issue-run.ts'
import {
  gradeIssueRunStatus,
  prepareIssueRunTask,
  type PreparedIssueRunTask,
} from '../graders/issue-run-status.ts'
import { GardenEvalError } from './errors.ts'
import {
  createGardenApiClient,
  type GardenIssueRunResponse,
} from './garden-api.ts'

export type IssueRunRunnerConfig = EvalConfiguration & {
  sessionCookie: string
  fetch?: typeof fetch
}

/**
 * Allocates evaluation and isolation IDs before the runner creates Garden
 * records. Before this helper, fixture failures had no stable trial identity.
 * Reference: `trialIdentitySchema` in `../index.ts`.
 */
export function createTrialIdentity(input: {
  taskId: string
  taskVersion: number
  repetition?: number
  seed?: number
}): TrialIdentity {
  return trialIdentitySchema.parse({
    evaluationId: randomUUID(),
    isolationId: randomUUID(),
    trialId: randomUUID(),
    taskId: input.taskId,
    taskVersion: input.taskVersion,
    repetition: input.repetition ?? 0,
    seed: input.seed ?? 0,
    allocatedAt: new Date().toISOString(),
  })
}

/**
 * Polls Garden until the run reaches a terminal status or the configured eval
 * deadline. Before this runner, evals had no observation loop for the durable
 * issue-run lifecycle. References: `GET /api/runs/$id` and
 * `issueRunStatusSchema`.
 */
async function waitForIssueRun(input: {
  api: ReturnType<typeof createGardenApiClient>
  issueId: string
  runId: string
  workspaceId: string
  deadlineAt: number
  pollIntervalMs: number
}): Promise<Result<GardenIssueRunResponse, GardenEvalError>> {
  return Result.gen(async function* () {
    let observed = yield* Result.await(
      input.api.getIssueRun({
        issueId: input.issueId,
        runId: input.runId,
        deadlineAt: input.deadlineAt,
      }),
    )

    while (
      !isTerminalRunStatus(observed.run.status) &&
      Date.now() < input.deadlineAt
    ) {
      const delayMs = Math.min(
        input.pollIntervalMs,
        input.deadlineAt - Date.now(),
      )
      await sleep(delayMs)
      if (Date.now() >= input.deadlineAt) break

      observed = yield* Result.await(
        input.api.getIssueRun({
          issueId: input.issueId,
          runId: input.runId,
          deadlineAt: input.deadlineAt,
        }),
      )
    }

    if (
      observed.run.id !== input.runId ||
      observed.run.issue_id !== input.issueId ||
      observed.run.workspace_id !== input.workspaceId
    ) {
      yield* new GardenEvalError({
        stage: 'evidence_collection',
        code: 'identity_mismatch',
        message: 'Garden returned a run from a different issue or workspace.',
        invalidReason: 'required_evidence_unavailable',
        issueId: input.issueId,
        runId: input.runId,
      })
    }

    return Result.ok(observed)
  })
}

/**
 * Returns whether Garden has stored a terminal issue-run status. The explicit
 * cases match Garden's current run-status contract in `issue-values.ts`.
 */
function isTerminalRunStatus(status: IssueRunStatus) {
  switch (status) {
    case 'succeeded':
    case 'failed':
    case 'cancelled':
    case 'blocked':
      return true
    case 'queued':
    case 'running':
    case 'waiting_for_input':
    case 'waiting_for_approval':
      return false
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

/**
 * Runs one status task through Garden's authenticated issue API. Before this
 * function, the package only described tasks and evidence. References:
 * `POST /api/issues`, `POST /api/issues/$id/runs`, and `GET /api/runs/$id`.
 */
export async function runIssueRunTask(input: {
  task: TaskDefinition
  identity: TrialIdentity
  config: IssueRunRunnerConfig
}): Promise<Result<TrialReport, GardenEvalError>> {
  return Result.gen(async function* () {
    const task: PreparedIssueRunTask = yield* Result.await(
      Promise.resolve(prepareIssueRunTask(input.task)),
    )

    if (
      input.identity.taskId !== input.task.taskId ||
      input.identity.taskVersion !== input.task.version
    ) {
      yield* new GardenEvalError({
        stage: 'fixture_setup',
        code: 'task_identity_mismatch',
        message: 'Trial identity does not match the task definition.',
        invalidReason: 'fixture_setup_failed',
      })
    }

    const configuration = evalConfigurationSchema.safeParse(input.config)
    const safeConfigurationResult =
      !configuration.success ||
      !input.config.sessionCookie ||
      /[\r\n]/.test(input.config.sessionCookie)
        ? Result.err(
            new GardenEvalError({
              stage: 'fixture_setup',
              code: 'invalid_runner_config',
              message:
                'The Garden eval target, IDs, deadline, poll interval, or session cookie is invalid.',
              invalidReason: 'unsupported_environment',
            }),
          )
        : Result.ok(configuration.data)

    const safeConfiguration = yield* Result.await(
      Promise.resolve(safeConfigurationResult),
    )
    const deadlineAt = Date.now() + safeConfiguration.deadlineMs
    const api = createGardenApiClient({
      ...safeConfiguration,
      sessionCookie: input.config.sessionCookie,
      fetch: input.config.fetch,
    })
    const issue = yield* Result.await(
      api.createIssue({
        workspaceId: safeConfiguration.workspaceId,
        agentId: safeConfiguration.agentId,
        title: `Garden eval ${input.identity.trialId}`,
        description: [
          task.definition.prompt,
          '',
          'Evaluation input:',
          JSON.stringify(task.definition.input, null, 2),
          '',
          `Task: ${task.definition.taskId} v${task.definition.version}`,
          `Trial: ${input.identity.trialId}`,
        ].join('\n'),
        deadlineAt,
      }),
    )

    if (
      issue.workspace_id !== safeConfiguration.workspaceId ||
      issue.assignee_id !== safeConfiguration.agentId
    ) {
      yield* new GardenEvalError({
        stage: 'fixture_setup',
        code: 'identity_mismatch',
        message:
          'Garden created the eval issue in a different workspace or agent.',
        invalidReason: 'fixture_setup_failed',
        issueId: issue.id,
      })
    }

    const start = yield* Result.await(
      api.startIssueRun({ issueId: issue.id, deadlineAt }),
    )
    if (start.kind === 'skipped') {
      return Result.err(
        new GardenEvalError({
          stage: 'garden_execution',
          code: 'run_start_skipped',
          message: 'Garden skipped the issue-run start request.',
          invalidReason: 'garden_execution_failed',
          issueId: issue.id,
        }),
      )
    }

    const observed = yield* Result.await(
      waitForIssueRun({
        api,
        issueId: issue.id,
        runId: start.runId,
        workspaceId: safeConfiguration.workspaceId,
        deadlineAt,
        pollIntervalMs: input.config.pollIntervalMs,
      }),
    )
    const evidence = createIssueRunEvidence({
      identity: input.identity,
      requiredSources: ['issue_run'],
      run: observed.run,
    })
    const report = yield* Result.await(
      Promise.resolve(
        gradeIssueRunStatus({
          task,
          identity: input.identity,
          configuration: safeConfiguration,
          issueId: issue.id,
          run: observed.run,
          evidence,
        }),
      ),
    )

    return Result.ok(report)
  })
}

/**
 * Turns an infrastructure or evidence error into a persisted invalid report.
 * Before this helper, the contract could describe invalid trials but the
 * runner had no conversion from typed errors. References: `trialReportSchema`
 * and `GardenEvalError`.
 */
export function createInvalidTrialReport(input: {
  identity: TrialIdentity
  configuration: EvalConfiguration
  error: GardenEvalError
}): TrialReport {
  return trialReportSchema.parse({
    reportId: randomUUID(),
    trial: input.identity,
    configuration: input.configuration,
    issueId: input.error.issueId,
    runId: input.error.runId,
    recordedAt: new Date().toISOString(),
    outcome: 'invalid',
    checks: [],
    invalidReason: input.error.invalidReason,
    diagnostic: {
      stage: input.error.stage,
      code: input.error.code,
      message: input.error.message,
    },
  })
}
