import { z } from 'zod'

const taskEvidenceSourceSchema = z.enum([
  'issue_run',
  'issue_run_events',
  'issue_work_products',
  'connector_receipts',
])

const taskSuiteSchema = z.enum([
  'routing',
  'durability',
  'permissions',
  'artifacts',
  'collaboration',
])

/**
 * Defines serializable task data. Grader code stays in the eval implementation
 * layer, and unique criterion IDs keep report checks tied to one task rule.
 */
export const taskDefinitionSchema = z
  .object({
    taskId: z.string().min(1),
    version: z.number().int().positive(),
    suite: taskSuiteSchema,
    surface: z.literal('issue_run'),
    fixture: z
      .object({
        fixtureId: z.string().min(1),
        version: z.number().int().positive(),
      })
      .strict(),
    title: z.string().min(1),
    prompt: z.string().min(1),
    input: z.json(),
    capabilities: z
      .object({
        connectors: z.array(z.string().min(1)),
        permissions: z.array(z.string().min(1)),
      })
      .strict(),
    successCriteria: z
      .array(
        z
          .object({
            criterionId: z.string().min(1),
            graderId: z.string().min(1),
            description: z.string().min(1),
            expected: z.json(),
            requiredEvidence: z.array(taskEvidenceSourceSchema).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((task, ctx) => {
    const criterionIds = new Set<string>()
    for (const [index, criterion] of task.successCriteria.entries()) {
      if (criterionIds.has(criterion.criterionId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['successCriteria', index, 'criterionId'],
          message: 'Criterion IDs must be unique within a task.',
        })
      }
      criterionIds.add(criterion.criterionId)
    }
  })

/**
 * Records evaluation, isolation, and trial IDs before fixture setup. These
 * identities remain available when setup fails before an issue run exists.
 */
export const trialIdentitySchema = z
  .object({
    trialId: z.string().uuid(),
    evaluationId: z.string().uuid(),
    isolationId: z.string().uuid(),
    taskId: z.string().min(1),
    taskVersion: z.number().int().positive(),
    repetition: z.number().int().nonnegative(),
    seed: z.number().int(),
    allocatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((identity, ctx) => {
    if (
      identity.trialId === identity.evaluationId ||
      identity.trialId === identity.isolationId ||
      identity.evaluationId === identity.isolationId
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['isolationId'],
        message: 'Trial, evaluation, and isolation IDs must be distinct.',
      })
    }
  })

export const issueRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_input',
  'waiting_for_approval',
  'succeeded',
  'failed',
  'cancelled',
  'blocked',
])

const evidenceReferenceSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/)

const issueRunEvidenceSchema = z
  .object({
    id: z.string().uuid(),
    issueId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    status: issueRunStatusSchema,
    resultDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    resultReference: evidenceReferenceSchema.optional(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

const issueRunEventEvidenceSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    seq: z.number().int().positive(),
    eventType: z.string().min(1),
    digest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    reference: evidenceReferenceSchema.optional(),
    createdAt: z.iso.datetime(),
  })
  .strict()

const connectorReceiptEvidenceSchema = z
  .object({
    receiptId: z.string().uuid(),
    runId: z.string().uuid(),
    isolationId: z.string().uuid(),
    connectorId: z.string().min(1),
    action: z.string().min(1),
    outcome: z.enum(['performed', 'denied', 'failed']),
    targetDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    occurredAt: z.iso.datetime(),
  })
  .strict()

const issueWorkProductEvidenceSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    type: z.string().min(1),
    status: z.string().min(1),
    digest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    reference: evidenceReferenceSchema.optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

const completeEvidenceCollectionSchema = z
  .object({ status: z.literal('complete') })
  .strict()
const incompleteEvidenceCollectionSchema = z
  .object({
    status: z.literal('incomplete'),
    missingSources: z.array(taskEvidenceSourceSchema).min(1),
    reasonCode: z.enum([
      'source_unavailable',
      'source_query_failed',
      'source_identity_mismatch',
      'source_integrity_unknown',
    ]),
  })
  .strict()

const evidenceBundleBaseSchema = z
  .object({
    trialId: z.string().uuid(),
    isolationId: z.string().uuid(),
    runId: z.string().uuid(),
    events: z.array(issueRunEventEvidenceSchema),
    workProducts: z.array(issueWorkProductEvidenceSchema),
    connectorReceipts: z.array(connectorReceiptEvidenceSchema),
  })
  .strict()

const completeIssueRunEvidenceBundleSchema = evidenceBundleBaseSchema
  .extend({
    run: issueRunEvidenceSchema,
    collection: completeEvidenceCollectionSchema,
  })
  .strict()

const incompleteIssueRunEvidenceBundleSchema = evidenceBundleBaseSchema
  .extend({
    run: issueRunEvidenceSchema.optional(),
    collection: incompleteEvidenceCollectionSchema,
  })
  .strict()

/**
 * Binds evidence to one Garden issue run. Collection state records persistence
 * gaps so missing evidence cannot be treated as a failed task result.
 */
export const issueRunEvidenceBundleSchema = z
  .union([
    completeIssueRunEvidenceBundleSchema,
    incompleteIssueRunEvidenceBundleSchema,
  ])
  .superRefine((bundle, ctx) => {
    if ('run' in bundle && bundle.run && bundle.run.id !== bundle.runId) {
      ctx.addIssue({
        code: 'custom',
        path: ['run', 'id'],
        message: 'Issue run id must match the evidence bundle runId.',
      })
    }
    for (const [index, event] of bundle.events.entries()) {
      if (event.runId !== bundle.runId) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', index, 'runId'],
          message: 'Event runId must match the evidence bundle runId.',
        })
      }
      const previousSeq = bundle.events[index - 1]?.seq
      if (previousSeq !== undefined && event.seq <= previousSeq) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', index, 'seq'],
          message: 'Issue-run events must be ordered by increasing seq.',
        })
      }
    }
    for (const [index, product] of bundle.workProducts.entries()) {
      if (product.runId !== bundle.runId) {
        ctx.addIssue({
          code: 'custom',
          path: ['workProducts', index, 'runId'],
          message: 'Work product runId must match the evidence bundle runId.',
        })
      }
    }
    for (const [index, receipt] of bundle.connectorReceipts.entries()) {
      if (receipt.runId !== bundle.runId) {
        ctx.addIssue({
          code: 'custom',
          path: ['connectorReceipts', index, 'runId'],
          message: 'Receipt runId must match the evidence bundle runId.',
        })
      }
      if (receipt.isolationId !== bundle.isolationId) {
        ctx.addIssue({
          code: 'custom',
          path: ['connectorReceipts', index, 'isolationId'],
          message:
            'Receipt isolationId must match the evidence bundle isolationId.',
        })
      }
    }
  })

const trialCheckSchema = z
  .object({
    criterionId: z.string().min(1),
    passed: z.boolean(),
    evidenceReferences: z.array(evidenceReferenceSchema),
  })
  .strict()

const trialInvalidReasonSchema = z.enum([
  'fixture_setup_failed',
  'garden_execution_failed',
  'required_evidence_unavailable',
  'grader_execution_failed',
  'unsupported_environment',
])

const trialReportBaseSchema = z
  .object({
    reportId: z.string().uuid(),
    trial: trialIdentitySchema,
    recordedAt: z.iso.datetime(),
  })
  .strict()

/** Stores a result separately from collection validity and grader logic. */
export const trialReportSchema = z
  .discriminatedUnion('outcome', [
    trialReportBaseSchema
      .extend({
        outcome: z.literal('passed'),
      checks: z
        .array(trialCheckSchema.extend({ passed: z.literal(true) }))
        .min(1),
        evidence: issueRunEvidenceBundleSchema.refine(
          (bundle) => bundle.collection.status === 'complete',
        ),
      })
      .strict(),
    trialReportBaseSchema
      .extend({
        outcome: z.literal('failed'),
      checks: z
        .array(trialCheckSchema)
        .min(1)
        .refine((checks) => checks.some((check) => !check.passed)),
        evidence: issueRunEvidenceBundleSchema.refine(
          (bundle) => bundle.collection.status === 'complete',
        ),
      })
      .strict(),
    trialReportBaseSchema
      .extend({
        outcome: z.literal('invalid'),
      checks: z.array(trialCheckSchema),
        evidence: issueRunEvidenceBundleSchema.optional(),
        invalidReason: trialInvalidReasonSchema,
      })
      .strict(),
  ])
  .superRefine((report, ctx) => {
    if (!('evidence' in report) || !report.evidence) return

    if (report.evidence.trialId !== report.trial.trialId) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'trialId'],
        message: 'Evidence trialId must match the report trialId.',
      })
    }
    if (report.evidence.isolationId !== report.trial.isolationId) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'isolationId'],
        message: 'Evidence isolationId must match the report isolationId.',
      })
    }
  })

export type TaskDefinition = z.infer<typeof taskDefinitionSchema>
export type TaskEvidenceSource = z.infer<typeof taskEvidenceSourceSchema>
export type TaskSuite = z.infer<typeof taskSuiteSchema>
export type TrialIdentity = z.infer<typeof trialIdentitySchema>
export type IssueRunStatus = z.infer<typeof issueRunStatusSchema>
export type IssueRunEvidenceBundle = z.infer<
  typeof issueRunEvidenceBundleSchema
>
export type TrialReport = z.infer<typeof trialReportSchema>
export type TrialInvalidReason = z.infer<typeof trialInvalidReasonSchema>
