import { getApiTransport } from './state'

export const decideAnalysisKeys = {
  run: (runId: string) => ['decide-analysis', runId] as const,
}

export type DecideAnalysisStatus =
  | 'queued'
  | 'running'
  | 'cancel_requested'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type DecideAnalysisFile = { name: string; url: string }

/** The fields of a Decide run snapshot the Decide card reads. */
export type DecideAnalysis = {
  runId: string
  status: DecideAnalysisStatus
  progress: { message?: string } | null
  error: { code: string; message: string } | null
  files: DecideAnalysisFile[]
  createdAt: string
  startedAt: string | null
}

/**
 * Reads one Decide run through the owner-agnostic route, so the same card
 * works in a chat and on an automation run. The server authorizes the
 * caller against the run's workspace and owner.
 */
export function getDecideAnalysis(runId: string): Promise<DecideAnalysis> {
  return getApiTransport().request(`/api/decide-analyses/${runId}`)
}

export function cancelDecideAnalysis(runId: string): Promise<DecideAnalysis> {
  return getApiTransport().request(`/api/decide-analyses/${runId}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'cancel' }),
  })
}
