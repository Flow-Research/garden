import { hasToolCall, type UIMessage } from 'ai'
import { z } from 'zod'
import {
  decideGeneratedFiles,
  decideResultTexts,
} from './decide-analysis-result'
import { EXECUTOR_TOOL_KEY_PREFIX } from './runtime-mcp-controller'

/** AI SDK tool key for the chat-facing Decide analyze tool. */
export const DECIDE_ANALYZE_TOOL_KEY = `${EXECUTOR_TOOL_KEY_PREFIX}decide_analyze`

export const DECIDE_ANALYSIS_RESULT_KIND = 'decide_analysis_result'

/**
 * Ends the turn in the step that started a Decide run. Before, the turn kept
 * going after the start, so the model slept, started a second paid run, and
 * redid the analysis in the sandbox. The answer now arrives in a later
 * delivery turn.
 */
export const stopAfterDecideAnalysisStarts = hasToolCall(
  DECIDE_ANALYZE_TOOL_KEY,
)

/**
 * The tools a chat turn may call. Before, a delivery turn only lost the
 * Decide tools, so after a failed run the model ran its own local analysis
 * with the sandbox and document tools. A delivery turn now gets none: its
 * one job is to write Decide's answer or error. Other turns keep every
 * visible tool.
 */
export function chatTurnActiveTools(
  activeTools: readonly string[],
  turn: { isDecideDelivery: boolean; isVisible: (key: string) => boolean },
): string[] {
  return turn.isDecideDelivery ? [] : activeTools.filter(turn.isVisible)
}

const deliveryMetadataSchema = z.object({
  garden: z.object({
    kind: z.literal(DECIDE_ANALYSIS_RESULT_KIND),
    runId: z.string(),
  }),
})

/** True when a message is Garden's internal Decide result hand-off. */
export function isDecideAnalysisResultMessage(message: { metadata?: unknown }) {
  return deliveryMetadataSchema.safeParse(message.metadata).success
}

/** True when the turn is answering a Decide result hand-off. */
export function isDecideAnalysisDeliveryTurn(messages: readonly UIMessage[]) {
  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === 'user')
  return latestUser ? isDecideAnalysisResultMessage(latestUser) : false
}

export const DECIDE_ANALYSIS_DELIVERY_INSTRUCTIONS = [
  'The latest user message is an internal hand-off from Garden. It carries the result of the Decide analysis the user asked for earlier in this chat.',
  "Write the answer to the user's analysis question from Decide's findings. Lead with the answer.",
  "Keep Decide's numbers exactly as given. Do not recompute, round, or add figures Decide did not report.",
  'Garden shows each generated file to the user as a download card. Refer to a file by its name when it helps, and do not paste file URLs.',
  "Leave out Decide's own narration, progress notes, session IDs, and run IDs. Do not mention that an internal message arrived.",
  'If the analysis failed, explain the error in plain language and what the user can do about it. For example, if Decide credits are exhausted, tell the user to top up their Decide account. Do not retry the analysis.',
].join('\n')

const errorSchema = z.object({ message: z.string() })

export type DecideAnalysisDeliveryRun = {
  runId: string
  attempt: number
  status: string
  resultJson: unknown
  errorJson: unknown
}

function completedText(resultJson: unknown) {
  const findings = decideResultTexts(resultJson)
  const files = decideGeneratedFiles(resultJson)
  return [
    'Decide finished the analysis. Its output follows, in order.',
    findings.length > 0
      ? `<decide_output>\n${findings.join('\n\n')}\n</decide_output>`
      : 'Decide returned no text findings.',
    files.length > 0
      ? `Generated files, already shown to the user as download cards:\n${files.map((file) => `- ${file.name}`).join('\n')}`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n')
}

function failedText(errorJson: unknown) {
  const parsed = errorSchema.safeParse(errorJson)
  const message = parsed.success ? parsed.data.message.trim() : ''
  return [
    'The Decide analysis failed.',
    message ? `Error from Decide: ${message}` : 'Decide gave no error message.',
  ].join('\n\n')
}

/**
 * Builds the internal user message that hands a finished run to the chat
 * model. It replaces the raw assistant message the Workflow used to append,
 * which spliced Decide's session IDs and progress logs into the transcript
 * mid-turn. The stable ID makes a replayed delivery a no-op. A cancelled or
 * unfinished run gets no message: the chat step already shows that outcome.
 */
export function decideAnalysisDeliveryMessage(
  run: DecideAnalysisDeliveryRun,
): UIMessage | null {
  const text =
    run.status === 'completed'
      ? completedText(run.resultJson)
      : run.status === 'failed'
        ? failedText(run.errorJson)
        : null
  if (text === null) return null
  return {
    id: `decide-analysis:${run.runId}:attempt:${run.attempt}`,
    role: 'user',
    metadata: {
      garden: { kind: DECIDE_ANALYSIS_RESULT_KIND, runId: run.runId },
    },
    parts: [{ type: 'text', text }],
  }
}
