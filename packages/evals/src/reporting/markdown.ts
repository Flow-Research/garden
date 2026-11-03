import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Result } from 'better-result'
import { trialReportSchema, type TrialReport } from '../index.ts'
import { GardenEvalError } from '../runner/errors.ts'

/**
 * Renders a short report from validated trial data. Before evals, Garden had
 * no report that linked a verdict to its trial and run IDs. References:
 * `trialReportSchema` and the Markdown artifact requirement in the eval design.
 */
export function renderTrialReportMarkdown(report: TrialReport) {
  const lines = [
    '# Garden eval result',
    '',
    `Outcome: **${report.outcome}**`,
    `Task: \`${report.trial.taskId}\` v${report.trial.taskVersion}`,
    `Evaluation ID: \`${report.trial.evaluationId}\``,
    `Trial ID: \`${report.trial.trialId}\``,
    `Issue ID: \`${report.issueId ?? 'not created'}\``,
    `Run ID: \`${report.runId ?? 'not started'}\``,
    '',
    '## Run configuration',
    '',
    `- Target: \`${report.configuration.baseUrl}\``,
    `- Workspace ID: \`${report.configuration.workspaceId}\``,
    `- Agent ID: \`${report.configuration.agentId}\``,
    `- Deadline: ${report.configuration.deadlineMs} ms`,
    `- Poll interval: ${report.configuration.pollIntervalMs} ms`,
  ]

  if (
    'evidence' in report &&
    report.evidence &&
    'run' in report.evidence &&
    report.evidence.run
  ) {
    lines.push('', `Observed run status: **${report.evidence.run.status}**`)
    if (report.evidence.run.usage) {
      const usage = report.evidence.run.usage
      lines.push(
        `Model: \`${usage.model}\` via \`${usage.modelProvider}\``,
        `Usage: ${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens, ${usage.cachedInputTokens} cached input tokens, ${usage.totalTokens} total tokens, ${usage.stepCount} steps`,
      )
    }
  }

  if (report.outcome === 'invalid') {
    lines.push(
      `Invalid reason: \`${report.invalidReason}\``,
      `Stage: \`${report.diagnostic.stage}\``,
      `Diagnostic: ${report.diagnostic.message}`,
    )
  } else {
    lines.push('', '## Checks', '')
    for (const check of report.checks) {
      lines.push(`- ${check.passed ? 'PASS' : 'FAIL'} \`${check.criterionId}\``)
    }
  }

  return `${lines.join('\n')}\n`
}

/**
 * Writes JSON and Markdown reports outside Garden's product database. Before
 * this function, the eval contract had no durable file output. References:
 * Node.js `node:fs/promises` and `trialReportSchema`.
 */
export async function writeTrialReport(input: {
  report: TrialReport
  outputDirectory: string
}): Promise<
  Result<{ jsonPath: string; markdownPath: string }, GardenEvalError>
> {
  const parsed = trialReportSchema.safeParse(input.report)
  if (!parsed.success) {
    return Result.err(
      new GardenEvalError({
        stage: 'grading',
        code: 'invalid_report',
        message: 'The eval runner produced a report that failed validation.',
        invalidReason: 'grader_execution_failed',
      }),
    )
  }

  const reportDirectory = resolve(
    input.outputDirectory,
    parsed.data.trial.evaluationId,
  )
  const jsonPath = resolve(reportDirectory, `${parsed.data.trial.trialId}.json`)
  const markdownPath = resolve(
    reportDirectory,
    `${parsed.data.trial.trialId}.md`,
  )
  const writeResult = await Result.tryPromise({
    try: async () => {
      await mkdir(dirname(jsonPath), { recursive: true })
      await writeFile(jsonPath, JSON.stringify(parsed.data, null, 2))
      await writeFile(markdownPath, renderTrialReportMarkdown(parsed.data))
    },
    catch: (cause) =>
      new GardenEvalError({
        stage: 'grading',
        code: 'report_write_failed',
        message: 'The eval runner could not write its report files.',
        invalidReason: 'grader_execution_failed',
        cause,
      }),
  })

  return writeResult.map(() => ({ jsonPath, markdownPath }))
}
