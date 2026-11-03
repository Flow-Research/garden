import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
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

const gardenDecideMetaSchema = z.object({
  kind: z.literal('chat'),
  threadId: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
})

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
 * Starts a durable analysis only for metadata injected by Garden's runtime
 * wrapper. Direct MCP callers keep the synchronous tool behavior because they
 * do not have a trusted chat thread to receive the final result. Chat starts
 * never forward a model-supplied `session_id`: the service picks the session
 * from the thread's completed runs.
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
      owner: { kind: 'chat', threadId: parsedMeta.data.threadId },
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
            text:
              kind === 'started'
                ? DECIDE_ANALYSIS_STARTED_TEXT
                : DECIDE_ANALYSIS_ALREADY_RUNNING_TEXT,
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
