import { z } from 'zod'

/**
 * A file Garden reads for Decide, so the model never pastes its contents.
 * Adding Google Drive is one more variant here.
 */
export const decideAnalysisSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('brain_file'),
      fileId: z.string().trim().min(1).describe('Brain file id.'),
    })
    .strict(),
])

export type DecideAnalysisSource = z.infer<typeof decideAnalysisSourceSchema>

/**
 * Who a Decide run belongs to. Before, every run belonged to a chat thread,
 * so an automation could not own one. The owner decides dedupe (one active
 * run per owner), session reuse, access checks, and where the result goes.
 */
export type DecideAnalysisOwner =
  | { kind: 'chat'; threadId: string }
  | { kind: 'automation_run'; automationRunId: string }

/**
 * The owner Garden's runtime wrapper attaches to a `decide_analyze` call as
 * trusted MCP `_meta.garden`. The model never supplies it: the chat facet
 * sends its thread key and an automation facet sends its own run ID (the
 * facet name), so a start can never be attributed to an owner the caller
 * did not run under. The starter parses it with this same schema.
 */
export const gardenDecideMetaSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chat'),
    threadId: z.string().min(1),
    toolCallId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('automation_run'),
    automationRunId: z.string().min(1),
    toolCallId: z.string().min(1).optional(),
  }),
])

export type GardenDecideMeta = z.infer<typeof gardenDecideMetaSchema>

/**
 * How long Garden waits for one background Decide analysis. Before, the call
 * used the MCP SDK's 60s silence timeout, and Decide's progress events are
 * optional, so a run that went quiet for a minute was failed while Decide
 * kept working and charging. Decide no longer limits analysis time and has
 * no tool to fetch a result later (decide-mcp-integration-guide: analyze,
 * list_generated_files, read_generated_file, whoami), so Garden holds the
 * `analyze` request open for one total hour. Workflows give a step unlimited
 * wall-clock time while it waits on I/O
 * (developers.cloudflare.com/workflows/reference/limits), so the hour is a
 * product choice: long reports finish, and a request that never answers
 * still ends. It lives here so the Decide Workflow (apps/web) and the
 * automation `RunWorkflow` that waits on it share one bound.
 */
export const DECIDE_ANALYSIS_TIME_LIMIT_MS = 60 * 60 * 1000

/**
 * How long an automation run's `RunWorkflow` waits for its Decide run to
 * report back. The Decide provider step may run for the time limit plus one
 * minute (its step timeout), then the commit step retries up to 3 times
 * (5 s exponential, at most 35 s) and the notify step uses the Workflow
 * default of 5 retries (10 s exponential, at most about 5 minutes). Ten
 * minutes past the limit covers that whole tail, so the wait only times out
 * when the event was lost, and neither Workflow waits forever.
 */
export const DECIDE_ANALYSIS_OWNER_WAIT_MS =
  DECIDE_ANALYSIS_TIME_LIMIT_MS + 10 * 60 * 1000

export const DECIDE_ANALYSIS_FINISHED_EVENT_PREFIX =
  'decide-analysis-finished' as const

/** Workflow event type that wakes the owner of one Decide run. */
export function getDecideAnalysisFinishedEventType(decideRunId: string) {
  return `${DECIDE_ANALYSIS_FINISHED_EVENT_PREFIX}:${decideRunId}`
}

export const DECIDE_ANALYSIS_STATUSES = [
  'queued',
  'running',
  'cancel_requested',
  'completed',
  'failed',
  'cancelled',
] as const

export type DecideAnalysisStatus = (typeof DECIDE_ANALYSIS_STATUSES)[number]

export type DecideAnalysisProgress = {
  progress: number
  total?: number
  message?: string
  sequence: number
  updatedAt: string
}

export type DecideAnalysisWorkflowParams = {
  runId: string
  attempt: number
  workspaceId: string
  ownerUserId: string
  owner: DecideAnalysisOwner
  agentRuntimeName: string
}

export type DecideAnalysisWorkflowBinding = {
  create(input: {
    id: string
    params: DecideAnalysisWorkflowParams
  }): Promise<unknown>
}

export type DecideAnalysisSnapshot = {
  runId: string
  workspaceId: string
  ownerUserId: string
  owner: DecideAnalysisOwner
  status: DecideAnalysisStatus
  attempt: number
  progress: DecideAnalysisProgress | null
  providerSessionId: string | null
  result: unknown
  error: unknown
  cancelRequestedAt: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  deliveredAt: string | null
}

/**
 * What a chat start did. `already_running` is a normal product outcome: the
 * thread already has an active run, so Garden returns that run instead of
 * charging Decide for a second analysis.
 */
export type DecideAnalysisStartOutcome = {
  kind: 'started' | 'already_running'
  snapshot: DecideAnalysisSnapshot
}
