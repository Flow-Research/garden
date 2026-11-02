import { TaggedError } from 'better-result'
import type { TrialInvalidReason } from '../index.ts'

export type GardenEvalStage =
  | 'fixture_setup'
  | 'garden_execution'
  | 'evidence_collection'
  | 'grading'

/**
 * Carries a safe stage and diagnostic across the eval runner. Before this
 * boundary, the runner had no typed way to separate product failures from
 * setup and evidence failures. References: the trial report contract in
 * `../index.ts` and Garden issue-run API routes.
 */
export class GardenEvalError extends TaggedError('GardenEvalError')<{
  stage: GardenEvalStage
  code: string
  message: string
  invalidReason: TrialInvalidReason
  issueId?: string
  runId?: string
  cause?: unknown
}>() {}
