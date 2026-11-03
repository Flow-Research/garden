import {
  issueRunEvidenceBundleSchema,
  type IssueRunEvidenceBundle,
  type TaskEvidenceSource,
  type TrialIdentity,
} from '../index.ts'
import type { GardenIssueRunResponse } from '../runner/garden-api.ts'

/**
 * Normalizes the Garden run record into safe eval evidence. Before this
 * adapter, evals had no evidence form bound to a trial and run ID. The first
 * task stores status, identity, and safe usage fields. References:
 * `GET /api/runs/$id` and `toIssueRun` in
 * `packages/server/src/issues/run-service.ts`.
 */
export function createIssueRunEvidence(input: {
  identity: TrialIdentity
  run: GardenIssueRunResponse['run']
  requiredSources: TaskEvidenceSource[]
}): IssueRunEvidenceBundle {
  return issueRunEvidenceBundleSchema.parse({
    trialId: input.identity.trialId,
    isolationId: input.identity.isolationId,
    runId: input.run.id,
    requiredSources: input.requiredSources,
    run: {
      id: input.run.id,
      issueId: input.run.issue_id,
      workspaceId: input.run.workspace_id,
      status: input.run.status,
      usage: input.run.usage
        ? {
            inputTokens: input.run.usage.input_tokens,
            outputTokens: input.run.usage.output_tokens,
            cachedInputTokens: input.run.usage.cached_input_tokens,
            totalTokens: input.run.usage.total_tokens,
            model: input.run.usage.model,
            modelProvider: input.run.usage.model_provider,
            stepCount: input.run.usage.step_count,
            recordedAtMs: input.run.usage.recorded_at_ms,
          }
        : null,
      startedAt: input.run.started_at,
      finishedAt: input.run.finished_at,
      createdAt: input.run.created_at,
      updatedAt: input.run.updated_at,
    },
    events: [],
    workProducts: [],
    connectorReceipts: [],
    collection: { status: 'complete' },
  })
}
