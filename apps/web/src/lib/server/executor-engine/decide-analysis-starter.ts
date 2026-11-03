import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  gardenDecideMetaSchema,
  type DecideAnalysisOwner,
  type GardenDecideMeta,
} from '@garden/agent-runtime/src/decide-analysis-types'
import type { DirectDecideAnalysisStarter } from './direct-decide-mcp'
import {
  makeBrainSourceReader,
  type BrainSourceEnvironment,
} from '../decide-analysis/brain-source'
import {
  decideAnalysisErrorResult,
  startDecideAnalysis,
  type DecideAnalysisEnvironment,
  type DecideAnalysisInputData,
} from '../decide-analysis/service'

/**
 * Tool text the chat model reads after a chat start. The first release said
 * "Run ID: <id>", which gave the model nothing to do but wait, so it slept,
 * started a second paid run, and redid the analysis locally. The text now
 * says where the answer will appear and carries no IDs. `run_id` stays in
 * `structuredContent` because the chat step polls run status with it.
 */
export const DECIDE_ANALYSIS_STARTED_TEXT =
  'The analysis is running in the background. Its answer will be posted in this chat when it finishes.'
export const DECIDE_ANALYSIS_ALREADY_RUNNING_TEXT =
  'An analysis is already running in this chat. Its answer will appear here when it finishes.'

/**
 * Tool text an automation agent reads after a start. Its turn ends in this
 * step, and Garden resumes the run with the outcome, so the text says that
 * instead of pointing at a chat the automation does not have.
 */
export const DECIDE_ANALYSIS_AUTOMATION_STARTED_TEXT =
  'The analysis is running in the background. This automation run pauses now and resumes with the findings when the analysis finishes.'
export const DECIDE_ANALYSIS_AUTOMATION_ALREADY_RUNNING_TEXT =
  'An analysis is already running for this automation run. The run resumes with its findings when it finishes.'

const STARTED_TEXT = {
  chat: {
    started: DECIDE_ANALYSIS_STARTED_TEXT,
    already_running: DECIDE_ANALYSIS_ALREADY_RUNNING_TEXT,
  },
  automation_run: {
    started: DECIDE_ANALYSIS_AUTOMATION_STARTED_TEXT,
    already_running: DECIDE_ANALYSIS_AUTOMATION_ALREADY_RUNNING_TEXT,
  },
} as const

const ownerFromMeta = (meta: GardenDecideMeta): DecideAnalysisOwner =>
  meta.kind === 'chat'
    ? { kind: 'chat', threadId: meta.threadId }
    : { kind: 'automation_run', automationRunId: meta.automationRunId }

/**
 * Starts a durable analysis only for metadata injected by Garden's runtime
 * wrapper. Direct MCP callers keep the synchronous tool behavior because they
 * have no trusted owner to receive the final result. The owner is a chat
 * thread or, since automations can pause on Decide, an automation run; the
 * service checks either against the caller's workspace. Starts never forward
 * a model-supplied `session_id`: the service picks the session from the
 * owner's completed runs.
 *
 * A `source` reaches the service with the Brain reader, so Garden reads the
 * file and the model never pastes its contents. The tool boundary has already
 * rejected a call that sends both `data` and `source`.
 */
export const makeDecideAnalysisStarter =
  (input: {
    env: DecideAnalysisEnvironment & BrainSourceEnvironment
    session: { organizationId: string; userId: string }
  }): DirectDecideAnalysisStarter =>
  async ({ args, extra }): Promise<CallToolResult | null> => {
    const parsedMeta = gardenDecideMetaSchema.safeParse(extra._meta?.garden)
    if (!parsedMeta.success) return null

    const analysisInput: DecideAnalysisInputData | undefined =
      args.source !== undefined
        ? {
            kind: 'source',
            source: args.source,
            read: makeBrainSourceReader(input.env),
          }
        : args.data !== undefined
          ? { kind: 'text', text: args.data }
          : undefined

    const result = await startDecideAnalysis({
      env: input.env,
      workspaceId: input.session.organizationId,
      ownerUserId: input.session.userId,
      owner: ownerFromMeta(parsedMeta.data),
      idempotencyKey: parsedMeta.data.toolCallId ?? crypto.randomUUID(),
      question: args.question,
      ...(analysisInput === undefined ? {} : { input: analysisInput }),
      context: args.context,
    })

    return result.match({
      ok: ({ kind, snapshot }): CallToolResult => ({
        content: [
          {
            type: 'text' as const,
            text: STARTED_TEXT[parsedMeta.data.kind][kind],
          },
        ],
        structuredContent: {
          status: snapshot.status,
          run_id: snapshot.runId,
        },
      }),
      err: (error): CallToolResult => ({
        isError: true,
        content: [{ type: 'text' as const, text: error.message }],
        structuredContent: {
          status: 'error',
          failureStage: 'decide_analysis',
          error: decideAnalysisErrorResult(error),
        },
      }),
    })
  }
