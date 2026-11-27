import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { z } from 'zod'
import { issueRunTaskExample } from './examples/issue-run-task.ts'
import { evalConfigurationSchema } from './index.ts'
import {
  createInvalidTrialReport,
  createTrialIdentity,
  runIssueRunTask,
} from './runner/issue-run.ts'
import { writeTrialReport } from './reporting/markdown.ts'

/** Parses a positive millisecond value within the Node timeout limit. */
const positiveMillisecondsSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(evalConfigurationSchema.shape.deadlineMs)

const environmentSchema = z.object({
  GARDEN_EVAL_BASE_URL: evalConfigurationSchema.shape.baseUrl,
  GARDEN_EVAL_WORKSPACE_ID: evalConfigurationSchema.shape.workspaceId,
  GARDEN_EVAL_AGENT_ID: evalConfigurationSchema.shape.agentId,
  GARDEN_EVAL_SESSION_COOKIE: z
    .string()
    .min(1)
    .refine((value) => !/[\r\n]/.test(value)),
  GARDEN_EVAL_DEADLINE_MS: positiveMillisecondsSchema,
  GARDEN_EVAL_POLL_INTERVAL_MS: positiveMillisecondsSchema,
  GARDEN_EVAL_OUTPUT_DIRECTORY: z.string().min(1).optional(),
})

/**
 * Parses the CLI environment before the runner can send an authenticated
 * request. Before this boundary, no eval command checked the target URL or
 * required a dedicated workspace and agent. References: Garden API auth and
 * the Node.js `AbortSignal.timeout` maximum.
 */
async function main() {
  const environment = environmentSchema.safeParse(process.env)
  if (!environment.success) {
    process.stderr.write(
      'Set valid Garden eval URL, workspace, agent, session cookie, deadline, and poll interval values.\n',
    )
    process.exitCode = 2
    return
  }

  const configuration = evalConfigurationSchema.safeParse({
    baseUrl: environment.data.GARDEN_EVAL_BASE_URL,
    workspaceId: environment.data.GARDEN_EVAL_WORKSPACE_ID,
    agentId: environment.data.GARDEN_EVAL_AGENT_ID,
    deadlineMs: environment.data.GARDEN_EVAL_DEADLINE_MS,
    pollIntervalMs: environment.data.GARDEN_EVAL_POLL_INTERVAL_MS,
  })
  if (!configuration.success) {
    process.stderr.write('The Garden eval configuration is invalid.\n')
    process.exitCode = 2
    return
  }

  const outputDirectory = environment.data.GARDEN_EVAL_OUTPUT_DIRECTORY
    ? resolve(environment.data.GARDEN_EVAL_OUTPUT_DIRECTORY)
    : fileURLToPath(new URL('../../../.artifacts/evals/', import.meta.url))
  const identity = createTrialIdentity({
    taskId: issueRunTaskExample.taskId,
    taskVersion: issueRunTaskExample.version,
  })
  const runResult = await runIssueRunTask({
    task: issueRunTaskExample,
    identity,
    config: {
      ...configuration.data,
      sessionCookie: environment.data.GARDEN_EVAL_SESSION_COOKIE,
    },
  })
  const report = runResult.match({
    ok: (value) => value,
    err: (error) =>
      createInvalidTrialReport({
        identity,
        configuration: configuration.data,
        error,
      }),
  })
  const writeResult = await writeTrialReport({ report, outputDirectory })

  writeResult.match({
    ok: ({ jsonPath, markdownPath }) => {
      process.stdout.write(`Garden eval ${report.outcome}.\n`)
      process.stdout.write(`JSON report: ${jsonPath}\n`)
      process.stdout.write(`Markdown report: ${markdownPath}\n`)
      if (report.issueId)
        process.stdout.write(`Garden issue: ${report.issueId}\n`)
      if (report.runId) process.stdout.write(`Garden run: ${report.runId}\n`)
      process.exitCode =
        report.outcome === 'passed' ? 0 : report.outcome === 'failed' ? 1 : 2
    },
    err: (error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 2
    },
  })
}

await main()
