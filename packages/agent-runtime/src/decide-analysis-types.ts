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
  threadId: string
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
  threadId: string
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
}
