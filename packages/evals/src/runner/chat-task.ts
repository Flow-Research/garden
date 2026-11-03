import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { Result } from 'better-result'
import {
  chatTaskEvidenceSchema,
  chatTrialReportSchema,
  evalConfigurationSchema,
  type ChatTaskEvidence,
  type ChatTrialReport,
  type EvalConfiguration,
  type TrialIdentity,
} from '../index.ts'
import type { ChatEvalTask } from '../examples/chat-tasks.ts'
import { gradeChatTask, decideWorkbookEvidence } from '../graders/chat-task.ts'
import {
  inspectDecideWorkbook,
  type DecideWorkbookInspection,
} from '../graders/decide-workbook.ts'
import { GardenEvalError } from './errors.ts'
import {
  createGardenApiClient,
  type GardenDecideAnalysesResponse,
} from './garden-api.ts'
import { sendGardenChatTurn } from './chat-socket.ts'
import { createTrialIdentity } from './issue-run.ts'

export type ChatTaskRunnerConfig = EvalConfiguration & {
  sessionCookie: string
  fetch?: typeof fetch
}

export type ChatTaskRunResult = {
  report: ChatTrialReport
  response: string
}

/**
 * Runs one chat task through thread creation, document upload, and the normal
 * Agents chat request. Before this runner, evals only covered issue runs.
 * References: Garden's thread, document, WebSocket, and Decide status routes.
 */
export async function runChatTask(input: {
  task: ChatEvalTask
  config: ChatTaskRunnerConfig
  identity?: TrialIdentity
  repetition?: number
  seed?: number
}): Promise<Result<ChatTaskRunResult, GardenEvalError>> {
  const checkedConfig = evalConfigurationSchema.safeParse({
    baseUrl: input.config.baseUrl,
    workspaceId: input.config.workspaceId,
    agentId: input.config.agentId,
    deadlineMs: input.config.deadlineMs,
    pollIntervalMs: input.config.pollIntervalMs,
  })
  const validCookie =
    input.config.sessionCookie.length > 0 &&
    !/[\r\n]/.test(input.config.sessionCookie)
  const validIdentity =
    !input.identity ||
    (input.identity.taskId === input.task.definition.taskId &&
      input.identity.taskVersion === input.task.definition.version)
  if (!checkedConfig.success || !validCookie || !validIdentity) {
    return Result.err(
      new GardenEvalError({
        stage: 'fixture_setup',
        code: 'invalid_runner_config',
        message:
          'The Garden chat eval target, task identity, or session cookie is invalid.',
        invalidReason: 'unsupported_environment',
      }),
    )
  }
  if (input.task.definition.surface !== 'chat') {
    return Result.err(
      new GardenEvalError({
        stage: 'grading',
        code: 'unsupported_task_surface',
        message: 'The chat runner requires a chat task.',
        invalidReason: 'unsupported_environment',
      }),
    )
  }

  const configuration = {
    baseUrl: checkedConfig.data.baseUrl,
    workspaceId: checkedConfig.data.workspaceId,
    agentId: checkedConfig.data.agentId,
    deadlineMs: checkedConfig.data.deadlineMs,
    pollIntervalMs: checkedConfig.data.pollIntervalMs,
  }
  const identity =
    input.identity ??
    createTrialIdentity({
      taskId: input.task.definition.taskId,
      taskVersion: input.task.definition.version,
      repetition: input.repetition,
      seed: input.seed,
    })
  const deadlineAt = Date.now() + configuration.deadlineMs
  const api = createGardenApiClient({
    baseUrl: configuration.baseUrl,
    sessionCookie: input.config.sessionCookie,
    fetch: input.config.fetch,
  })

  return Result.gen(async function* () {
    const thread = yield* Result.await(
      api.createChatThread({
        threadId: identity.isolationId,
        agentId: configuration.agentId,
        title: `Garden eval ${input.task.definition.taskId} ${identity.trialId}`,
        deadlineAt,
      }),
    )
    if (thread.id !== identity.isolationId) {
      return Result.err(
        new GardenEvalError({
          stage: 'fixture_setup',
          code: 'thread_identity_mismatch',
          message: 'Garden returned a different chat thread ID.',
          invalidReason: 'fixture_setup_failed',
          threadId: thread.id,
        }),
      )
    }

    const uploaded = yield* Result.await(
      api.uploadChatDocument({
        threadId: thread.id,
        filename: input.task.filename,
        mediaType: input.task.mediaType,
        bytes: new TextEncoder().encode(input.task.contents),
        deadlineAt,
      }),
    )
    const documentContext = [
      'The user uploaded this workspace document for the current turn. Use the internal document handle only in document tool calls. Do not mention its handle or ID.',
      `- handle: ${uploaded.document_id}; filename: ${uploaded.filename} (V${uploaded.version_number})`,
    ].join('\n')
    const turn = yield* Result.await(
      sendGardenChatTurn({
        baseUrl: configuration.baseUrl,
        hostName: thread.hostName,
        runtimeKey: thread.runtime_key,
        sessionCookie: input.config.sessionCookie,
        prompt: input.task.definition.prompt,
        documentContext,
        deadlineAt,
        threadId: thread.id,
      }),
    )

    const expectsDecide = input.task.definition.capabilities.connectors.includes(
      'decide',
    )
    const decideAnalysis = yield* Result.await(
      collectDecideEvidence({
        api,
        threadId: thread.id,
        deadlineAt,
        pollIntervalMs: configuration.pollIntervalMs,
        waitForTerminal: expectsDecide,
        downloadWorkbook: expectsDecide,
      }),
    )

    const evidence: ChatTaskEvidence = chatTaskEvidenceSchema.parse({
      threadId: thread.id,
      assistantResponseDigest: responseDigest(turn.text),
      decideAnalysis,
    })
    const checks = yield* gradeChatTask({
      task: input.task.definition,
      threadId: thread.id,
      response: turn.text,
      decideAnalysis,
    })
    const outcome = checks.every((check) => check.passed) ? 'passed' : 'failed'
    const report = chatTrialReportSchema.safeParse({
      reportId: randomUUID(),
      trial: identity,
      configuration,
      task: {
        taskId: input.task.definition.taskId,
        version: input.task.definition.version,
      },
      threadId: thread.id,
      recordedAt: new Date().toISOString(),
      outcome,
      checks,
      evidence,
    })
    if (!report.success) {
      return Result.err(
        new GardenEvalError({
          stage: 'grading',
          code: 'invalid_report',
          message: 'The Garden chat grader produced an invalid trial report.',
          invalidReason: 'grader_execution_failed',
          threadId: thread.id,
        }),
      )
    }

    return Result.ok({ report: report.data, response: turn.text })
  })
}

/** Builds an invalid report when setup, execution, or evidence fails. */
export function createInvalidChatTrialReport(input: {
  task: ChatEvalTask
  identity: TrialIdentity
  configuration: EvalConfiguration
  error: GardenEvalError
}): ChatTrialReport {
  return chatTrialReportSchema.parse({
    reportId: randomUUID(),
    trial: input.identity,
    configuration: input.configuration,
    task: {
      taskId: input.task.definition.taskId,
      version: input.task.definition.version,
    },
    ...(input.error.threadId ? { threadId: input.error.threadId } : {}),
    recordedAt: new Date().toISOString(),
    outcome: 'invalid',
    checks: [],
    invalidReason: input.error.invalidReason,
    diagnostic: {
      stage: input.error.stage,
      code: input.error.code,
      message: input.error.message.slice(0, 300),
    },
  })
}

/** Waits for a thread's Decide run and returns its latest public snapshot. */
function collectDecideEvidence(input: {
  api: ReturnType<typeof createGardenApiClient>
  threadId: string
  deadlineAt: number
  pollIntervalMs: number
  waitForTerminal: boolean
  downloadWorkbook: boolean
}): Promise<Result<ChatTaskEvidence['decideAnalysis'], GardenEvalError>> {
  return Result.gen(async function* () {
    let latest: GardenDecideAnalysesResponse = yield* Result.await(
      input.api.listDecideAnalyses({
        threadId: input.threadId,
        deadlineAt: input.deadlineAt,
      }),
    )
    while (input.waitForTerminal && Date.now() < input.deadlineAt) {
      const onlyRun = latest.runs.length === 1 ? latest.runs[0] : undefined
      if (
        latest.runs.length > 1 ||
        (onlyRun !== undefined &&
          ['completed', 'failed', 'cancelled'].includes(onlyRun.status))
      ) {
        break
      }
      const remainingMs = input.deadlineAt - Date.now()
      if (remainingMs <= 0) break
      yield* Result.await(
        sleep(Math.min(input.pollIntervalMs, remainingMs)).then(() =>
          Result.ok(undefined),
        ),
      )
      if (Date.now() >= input.deadlineAt) break
      latest = yield* Result.await(
        input.api.listDecideAnalyses({
          threadId: input.threadId,
          deadlineAt: input.deadlineAt,
        }),
      )
    }

    const run = latest.runs.length === 1 ? latest.runs[0] : undefined
    const fileNames = run?.files.map((file) => file.name) ?? []
    const workbookLink = run?.files.find((file) =>
      file.name.toLowerCase().endsWith('.xlsx'),
    )
    let inspection: DecideWorkbookInspection | null = null
    if (input.downloadWorkbook && workbookLink && run) {
      const bytes = yield* Result.await(
        input.api.downloadDecideWorkbook({
          url: workbookLink.url,
          deadlineAt: input.deadlineAt,
          runId: run.runId,
        }),
      )
      inspection = await inspectDecideWorkbook(bytes)
    }

    const state = decideWorkbookEvidence({
      runId: run?.runId ?? '',
      observedRunCount: latest.runs.length,
      status: run?.status ?? null,
      fileNames,
      inspection,
    })
    return Result.ok(state)
  })
}

/** Hashes assistant text before the report leaves the eval process. */
function responseDigest(response: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(response).digest('hex')}`
}
