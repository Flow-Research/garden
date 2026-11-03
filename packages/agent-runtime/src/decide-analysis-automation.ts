import type { StopCondition, ToolSet } from 'ai'
import { z } from 'zod'
import {
  DECIDE_ANALYZE_TOOL_KEY,
  decideErrorMessage,
} from './decide-analysis-chat'
import {
  decideGeneratedFiles,
  decideResultTexts,
} from './decide-analysis-result'

const startedOutputSchema = z.object({
  isError: z.literal(false).optional(),
  structuredContent: z.object({ run_id: z.string().min(1) }),
})

/**
 * Ends an automation turn in the step where Decide accepted a run. Before,
 * an automation's `decide_analyze` call blocked on the MCP request, and a
 * quiet minute failed it. Now the run waits in `RunWorkflow` instead, so the
 * turn must end right after the start. Unlike chat, a refused start (input
 * too large, no data) keeps the turn going: the agent can still explain the
 * error in its output instead of ending with nothing.
 */
export const stopAfterAutomationDecideAnalysisStarts: StopCondition<
  ToolSet
> = ({ steps }) =>
  steps.some((step) =>
    step.toolResults.some(
      (result) =>
        result.toolName === DECIDE_ANALYZE_TOOL_KEY &&
        startedOutputSchema.safeParse(result.output).success,
    ),
  )

export type DecideAnalysisAutomationRun = {
  status: string
  resultJson: unknown
  errorJson: unknown
}

const NEXT_STEP =
  'Write the automation output from this outcome only, then call complete_automation. Do not run the analysis again or substitute your own analysis.'

function completedText(resultJson: unknown) {
  const findings = decideResultTexts(resultJson)
  const files = decideGeneratedFiles(resultJson)
  return [
    'Decide finished the analysis. Its output follows, in order.',
    findings.length > 0
      ? `<decide_output>\n${findings.join('\n\n')}\n</decide_output>`
      : 'Decide returned no text findings.',
    files.length > 0
      ? `Generated files. Link them in the report by these URLs:\n${files.map((file) => `- ${file.name}: ${file.url}`).join('\n')}`
      : null,
    "Keep Decide's numbers exactly as given. Leave out Decide's own narration, progress notes, session IDs, and run IDs.",
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n')
}

function failedText(errorJson: unknown) {
  const message = decideErrorMessage(errorJson)
  return [
    'The Decide analysis failed.',
    message ? `Error from Decide: ${message}` : 'Decide gave no error message.',
    'Report the failure in plain language as the output.',
  ].join('\n\n')
}

/**
 * The internal message that resumes an automation run after its Decide
 * pause. The chat hand-off (`decideAnalysisDeliveryMessage`) leaves file
 * URLs out because the chat shows file cards; an automation sends its report
 * by email or Slack, so it needs the links. Every outcome gets a message,
 * cancelled and unfinished too, because the run must still close with an
 * output. A run that is not terminal here means the Workflow wait timed out
 * and Garden has requested its cancellation.
 */
export function decideAnalysisAutomationResumeText(
  run: DecideAnalysisAutomationRun,
) {
  const outcome =
    run.status === 'completed'
      ? completedText(run.resultJson)
      : run.status === 'failed'
        ? failedText(run.errorJson)
        : run.status === 'cancelled'
          ? 'The Decide analysis was cancelled before it finished, so there are no findings. Report that as the output.'
          : 'Decide did not report back within its time limit, so Garden stopped waiting and cancelled the analysis. Report that as the output.'
  return [
    'Garden resumed this automation run. The Decide analysis you started earlier in this run has ended.',
    outcome,
    NEXT_STEP,
  ].join('\n\n')
}
