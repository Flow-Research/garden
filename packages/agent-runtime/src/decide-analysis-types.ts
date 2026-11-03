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
