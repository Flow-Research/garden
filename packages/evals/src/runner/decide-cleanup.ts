import { Result } from 'better-result'
import type {
  createGardenApiClient,
  GardenDecideAnalysesResponse,
} from './garden-api.ts'
import { GardenEvalError } from './errors.ts'

type RunStatus = GardenDecideAnalysesResponse['runs'][number]['status']
export type ObservedDecideRuns = Map<string, RunStatus>

export function recordDecideRuns(
  observed: ObservedDecideRuns,
  page: GardenDecideAnalysesResponse,
) {
  for (const run of page.runs) observed.set(run.runId, run.status)
}

export function hasLiveDecideRuns(observed: ObservedDecideRuns) {
  return [...observed.values()].some(
    (status) => status === 'queued' || status === 'running',
  )
}

/** Cancel only outstanding analyses reported by the verified trial thread. */
export async function cancelTrialAnalyses(
  api: Pick<
    ReturnType<typeof createGardenApiClient>,
    'listDecideAnalyses' | 'cancelDecideAnalysis'
  >,
  threadId: string,
  observed: ObservedDecideRuns,
  pollIntervalMs: number,
) {
  const latest = await api.listDecideAnalyses({
    threadId,
    deadlineAt: Date.now() + pollIntervalMs,
  })
  if (latest.isOk()) recordDecideRuns(observed, latest.value)
  const live = [...observed].filter(
    ([, status]) => status === 'queued' || status === 'running',
  )
  const deadlineAt = Date.now() + pollIntervalMs
  const requests = await Promise.all(
    live.map(async ([runId]) => {
      const result = await api.cancelDecideAnalysis({ runId, deadlineAt })
      return {
        runId,
        accepted:
          result.isOk() &&
          ['cancel_requested', 'cancelled', 'completed', 'failed'].includes(
            result.value.status,
          ),
      }
    }),
  )
  const failed = requests.find((request) => !request.accepted)
  if (latest.isErr() || failed) {
    return Result.err(
      new GardenEvalError({
        stage: 'evidence_collection',
        code: 'trial_cleanup_unconfirmed',
        message: failed
          ? 'Garden did not confirm the cancellation request for a trial analysis.'
          : 'Garden could not list every analysis for this trial during cleanup.',
        invalidReason: 'required_evidence_unavailable',
        threadId,
        ...(failed ? { runId: failed.runId } : {}),
      }),
    )
  }
  return Result.ok(undefined)
}
