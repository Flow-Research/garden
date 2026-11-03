import { z } from 'zod'

const taskEvidenceSourceSchema = z.enum([
  'issue_run',
  'issue_run_events',
  'issue_work_products',
  'connector_receipts',
  'chat_thread',
  'assistant_response',
  'decide_analysis',
  'decide_workbook',
])

const taskSuiteSchema = z.enum([
  'routing',
  'durability',
  'permissions',
  'artifacts',
  'collaboration',
])

/**
 * Limits authenticated eval traffic to local Garden or the dev deployment.
 * The CLI checked this before, but direct runner callers did not. This shared
 * schema now checks both paths. Reference: `runner/garden-api.ts`.
 */
const evalTargetUrlSchema = z.url().refine((value) => {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const gardenDevHost = url.hostname === 'garden-dev.flow-research.workers.dev'
  return (
    ((gardenDevHost && url.protocol === 'https:') ||
      (loopback && url.protocol === 'http:')) &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  )
})

/**
 * Records the safe settings that affect one issue-run trial. Before this
 * schema, reports could not explain which Garden target or budget produced a
 * result. It excludes the session cookie. Reference:
 * `docs/features/evaluation-system-design.md`.
 */
export const evalConfigurationSchema = z
  .object({
    baseUrl: evalTargetUrlSchema,
    workspaceId: z.string().uuid(),
    agentId: z.string().uuid(),
    deadlineMs: z.number().int().positive().max(2_147_483_647),
    pollIntervalMs: z.number().int().positive().max(2_147_483_647),
  })
  .strict()
  .superRefine((configuration, ctx) => {
    if (configuration.pollIntervalMs > configuration.deadlineMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['pollIntervalMs'],
        message: 'Poll interval must not exceed the eval deadline.',
      })
    }
  })

/**
 * Defines serializable task data. Grader code stays in the eval implementation
 * layer, and unique criterion IDs keep report checks tied to one task rule.
 */
export const taskDefinitionSchema = z
  .object({
    taskId: z.string().min(1),
    version: z.number().int().positive(),
    suite: taskSuiteSchema,
    surface: z.enum(['issue_run', 'chat']),
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

const issueRunUsageEvidenceSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    model: z.string().min(1),
    modelProvider: z.string().min(1),
    stepCount: z.number().int().nonnegative(),
    recordedAtMs: z.number().int().nonnegative(),
  })
  .strict()

const issueRunEvidenceSchema = z
  .object({
    id: z.string().uuid(),
    issueId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    status: issueRunStatusSchema,
    usage: issueRunUsageEvidenceSchema.nullable(),
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
    requiredSources: z.array(taskEvidenceSourceSchema).min(1),
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
    if (
      new Set(bundle.requiredSources).size !== bundle.requiredSources.length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['requiredSources'],
        message: 'Required evidence sources must be unique.',
      })
    }
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
    configuration: evalConfigurationSchema,
    issueId: z.string().uuid().optional(),
    runId: z.string().uuid().optional(),
    recordedAt: z.iso.datetime(),
  })
  .strict()

/** Stores a result separately from collection validity and grader logic. */
export const trialReportSchema = z
  .discriminatedUnion('outcome', [
    trialReportBaseSchema
      .extend({
        outcome: z.literal('passed'),
        issueId: z.string().uuid(),
        runId: z.string().uuid(),
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
        issueId: z.string().uuid(),
        runId: z.string().uuid(),
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
        diagnostic: z
          .object({
            stage: z.enum([
              'fixture_setup',
              'garden_execution',
              'evidence_collection',
              'grading',
            ]),
            code: z.string().min(1),
            message: z.string().min(1).max(300),
          })
          .strict(),
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
    if (report.runId && report.evidence.runId !== report.runId) {
      ctx.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'Report runId must match the evidence runId.',
      })
    }
    if (report.issueId && 'run' in report.evidence && report.evidence.run) {
      if (report.evidence.run.issueId !== report.issueId) {
        ctx.addIssue({
          code: 'custom',
          path: ['issueId'],
          message: 'Report issueId must match the evidence issueId.',
        })
      }
    }
  })

const chatWorkbookEvidenceSchema = z
  .object({
    name: z.string().min(1),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sheetNames: z.array(z.string().min(1)),
    opened: z.boolean(),
    rawDataPreserved: z.boolean(),
    verificationMatches: z.boolean(),
    analysisKeepsCorrectionSeparate: z.boolean(),
  })
  .strict()

const decideAnalysisEvidenceSchema = z
  .object({
    observedRunCount: z.number().int().nonnegative(),
    runId: z.string().uuid().nullable(),
    status: z
      .enum([
        'queued',
        'running',
        'cancel_requested',
        'completed',
        'failed',
        'cancelled',
      ])
      .nullable(),
    fileNames: z.array(z.string().min(1)),
    workbook: chatWorkbookEvidenceSchema.nullable(),
  })
  .strict()

/**
 * Keeps chat evidence small and safe. It stores hashes and public lifecycle
 * fields, not the uploaded document, workbook bytes, or Decide URLs.
 */
export const chatTaskEvidenceSchema = z
  .object({
    threadId: z.string().uuid(),
    assistantResponseDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/),
    decideAnalysis: decideAnalysisEvidenceSchema.nullable(),
  })
  .strict()

const chatTrialReportBaseSchema = z
  .object({
    reportId: z.string().uuid(),
    trial: trialIdentitySchema,
    configuration: evalConfigurationSchema,
    task: z
      .object({ taskId: z.string().min(1), version: z.number().int().positive() })
      .strict(),
    threadId: z.string().uuid().optional(),
    recordedAt: z.iso.datetime(),
  })
  .strict()

/** Records one chat task result without storing raw chat or file contents. */
export const chatTrialReportSchema = z
  .discriminatedUnion('outcome', [
    chatTrialReportBaseSchema
      .extend({
        outcome: z.literal('passed'),
        threadId: z.string().uuid(),
        checks: z
          .array(trialCheckSchema.extend({ passed: z.literal(true) }))
          .min(1),
        evidence: chatTaskEvidenceSchema,
      })
      .strict(),
    chatTrialReportBaseSchema
      .extend({
        outcome: z.literal('failed'),
        threadId: z.string().uuid(),
        checks: z
          .array(trialCheckSchema)
          .min(1)
          .refine((checks) => checks.some((check) => !check.passed)),
        evidence: chatTaskEvidenceSchema,
      })
      .strict(),
    chatTrialReportBaseSchema
      .extend({
        outcome: z.literal('invalid'),
        checks: z.array(trialCheckSchema),
        invalidReason: trialInvalidReasonSchema,
        diagnostic: z
          .object({
            stage: z.enum([
              'fixture_setup',
              'garden_execution',
              'evidence_collection',
              'grading',
            ]),
            code: z.string().min(1),
            message: z.string().min(1).max(300),
          })
          .strict(),
      })
      .strict(),
  ])
  .superRefine((report, ctx) => {
    if (!('evidence' in report)) return
    if (report.threadId !== report.evidence.threadId) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'threadId'],
        message: 'Chat evidence threadId must match the report threadId.',
      })
    }
    const decide = report.evidence.decideAnalysis
    if (decide && decide.observedRunCount === 1 && !decide.runId) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'decideAnalysis', 'runId'],
        message: 'One observed Decide run must have its run ID.',
      })
    }
    if (decide && decide.observedRunCount !== 1 && decide.runId) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'decideAnalysis', 'runId'],
        message: 'A run ID is only valid when exactly one Decide run exists.',
      })
    }
  })

export type TaskDefinition = z.infer<typeof taskDefinitionSchema>
export type TaskEvidenceSource = z.infer<typeof taskEvidenceSourceSchema>
export type TaskSuite = z.infer<typeof taskSuiteSchema>
export type EvalConfiguration = z.infer<typeof evalConfigurationSchema>
export type TrialIdentity = z.infer<typeof trialIdentitySchema>
export type IssueRunStatus = z.infer<typeof issueRunStatusSchema>
export type IssueRunEvidenceBundle = z.infer<
  typeof issueRunEvidenceBundleSchema
>
export type TrialReport = z.infer<typeof trialReportSchema>
export type ChatTaskEvidence = z.infer<typeof chatTaskEvidenceSchema>
export type ChatTrialReport = z.infer<typeof chatTrialReportSchema>
export type TrialInvalidReason = z.infer<typeof trialInvalidReasonSchema>
