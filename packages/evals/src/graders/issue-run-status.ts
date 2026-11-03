import { randomUUID } from 'node:crypto'
import { Result } from 'better-result'
import { z } from 'zod'
import {
  trialReportSchema,
  type IssueRunEvidenceBundle,
  type EvalConfiguration,
  type TaskDefinition,
  type TrialIdentity,
  type TrialReport,
} from '../index.ts'
import type { GardenIssueRunResponse } from '../runner/garden-api.ts'
import { GardenEvalError } from '../runner/errors.ts'

const terminalIssueRunStatusSchema = z.enum([
  'succeeded',
  'failed',
  'cancelled',
  'blocked',
])
const expectedStatusSchema = z
  .object({ status: terminalIssueRunStatusSchema })
  .strict()

export type PreparedIssueRunTask = {
  definition: TaskDefinition
  criteria: Array<{
    criterionId: string
    expectedStatus: z.infer<typeof terminalIssueRunStatusSchema>
  }>
}

/**
 * Checks that a task uses the one fixture, grader, and evidence source that
 * the first runner implements. Before this check, unsupported tasks could
 * start a real issue and fail only after execution. References:
 * `taskDefinitionSchema` and `docs/features/evaluation-system-design.md`.
 */
export function prepareIssueRunTask(
  task: TaskDefinition,
): Result<PreparedIssueRunTask, GardenEvalError> {
  if (
    task.surface !== 'issue_run' ||
    task.suite !== 'durability' ||
    task.fixture.fixtureId !== 'issue-run-status-v1' ||
    task.fixture.version !== 1
  ) {
    return Result.err(
      new GardenEvalError({
        stage: 'grading',
        code: 'unsupported_task',
        message: 'This runner supports the issue-run status fixture only.',
        invalidReason: 'unsupported_environment',
      }),
    )
  }

  if (
    task.capabilities.connectors.length > 0 ||
    task.capabilities.permissions.length > 0
  ) {
    return Result.err(
      new GardenEvalError({
        stage: 'grading',
        code: 'unsupported_capabilities',
        message:
          'This runner supports issue-run status tasks with no requested connectors or permissions.',
        invalidReason: 'unsupported_environment',
      }),
    )
  }

  const criteria: PreparedIssueRunTask['criteria'] = []
  for (const criterion of task.successCriteria) {
    if (criterion.graderId !== 'issue-run-status-equals') {
      return Result.err(
        new GardenEvalError({
          stage: 'grading',
          code: 'unsupported_grader',
          message: 'This runner supports issue-run status checks only.',
          invalidReason: 'unsupported_environment',
        }),
      )
    }
    if (
      criterion.requiredEvidence.length !== 1 ||
      criterion.requiredEvidence[0] !== 'issue_run'
    ) {
      return Result.err(
        new GardenEvalError({
          stage: 'grading',
          code: 'unsupported_evidence',
          message: 'This runner requires issue-run status evidence only.',
          invalidReason: 'unsupported_environment',
        }),
      )
    }

    const expected = expectedStatusSchema.safeParse(criterion.expected)
    if (!expected.success) {
      return Result.err(
        new GardenEvalError({
          stage: 'grading',
          code: 'invalid_criterion',
          message:
            'The issue-run status criterion has an invalid expected value.',
          invalidReason: 'grader_execution_failed',
        }),
      )
    }
    criteria.push({
      criterionId: criterion.criterionId,
      expectedStatus: expected.data.status,
    })
  }

  return Result.ok({ definition: task, criteria })
}

/**
 * Grades only the stored issue-run status. Before the grader existed, the eval
 * contract had no deterministic status check. References: Garden's run-status
 * enum and `trialReportSchema`.
 */
export function gradeIssueRunStatus(input: {
  task: PreparedIssueRunTask
  identity: TrialIdentity
  configuration: EvalConfiguration
  issueId: string
  run: GardenIssueRunResponse['run']
  evidence: IssueRunEvidenceBundle
}): Result<TrialReport, GardenEvalError> {
  const checks = input.task.criteria.map((criterion) => ({
    criterionId: criterion.criterionId,
    passed: input.run.status === criterion.expectedStatus,
    evidenceReferences: [`issue-run:${input.run.id}`],
  }))
  const outcome = checks.every((check) => check.passed) ? 'passed' : 'failed'

  const report = trialReportSchema.safeParse({
    reportId: randomUUID(),
    trial: input.identity,
    configuration: input.configuration,
    issueId: input.issueId,
    runId: input.run.id,
    recordedAt: new Date().toISOString(),
    outcome,
    checks,
    evidence: input.evidence,
  })
  if (!report.success) {
    return Result.err(
      new GardenEvalError({
        stage: 'grading',
        code: 'invalid_report',
        message: 'The issue-run grader produced an invalid trial report.',
        invalidReason: 'grader_execution_failed',
      }),
    )
  }

  return Result.ok(report.data)
}
