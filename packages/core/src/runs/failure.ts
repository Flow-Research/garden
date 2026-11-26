import { Result, TaggedError } from 'better-result'
import { z } from 'zod'
import type { ConnectorError } from '../connectors/errors'

/** Closed list of user-visible issue run failure causes. */
export const RUN_FAILURE_CAUSES = [
  'subrequest_limit',
  'output_cap_reached',
  'run_token_budget_exceeded',
  'model_unavailable',
  'model_retired',
  'tool_failed',
  'turn_timed_out',
  'turn_ended_without_resolution',
  'no_resolution',
  'no_output',
  'brain_output_authority_denied',
  'approval_stale',
  'turn_aborted',
  'turn_skipped',
  'workflow_ended_with_live_run',
  'workflow_start_failed',
  'unknown',
] as const

export type RunFailureCause = (typeof RUN_FAILURE_CAUSES)[number]

const runFailureCategorySchema = z.enum([
  'platform_limit',
  'model',
  'tool',
  'run_lifecycle',
  'permissions',
  'approval',
  'unknown',
])

const connectorErrorKindSchema = z.enum([
  'auth',
  'permission',
  'rate_limit',
  'other',
])

/** Safe connector details used to select next-step copy. */
export const runFailureContextSchema = z
  .object({
    connectorId: z.string().optional(),
    connectorName: z.string().optional(),
    connectorErrorKind: connectorErrorKindSchema.optional(),
    toolName: z.string().optional(),
  })
  .strict()

/** Validates a failure cause from stored or runtime data. */
export const runFailureCauseSchema = z.enum(RUN_FAILURE_CAUSES)

/** Validates failure data that may cross a storage or API boundary. */
export const publicRunFailureSchema = z
  .object({
    cause: runFailureCauseSchema,
    context: runFailureContextSchema.optional(),
  })
  .strict()

export type PublicRunFailure = z.infer<typeof publicRunFailureSchema>

/** Runtime failure with a private diagnostic for server logs. */
export type RunFailure = PublicRunFailure & { diagnostic?: string }

/** Validates the public payload written to failed run events. */
export const runFailureEventPayloadSchema = z
  .object({ failure: publicRunFailureSchema })
  .strict()

/** Generic runtime failure details passed to provider matchers. */
export type RunFailureSignal = {
  error: unknown
  turnFlags?: { modelRetired?: boolean }
  toolError?: {
    connectorId?: string
    connectorName?: string
    kind?: ConnectorError['kind']
    toolName?: string
  }
}

/** Matches a runtime signal to a registered failure cause. */
export type RunFailureMatcher = {
  cause: RunFailureCause
  matches: (signal: RunFailureSignal) => boolean
}

/** Approved copy and policy for one registered failure cause. */
export type RunFailureDefinition = {
  category: z.infer<typeof runFailureCategorySchema>
  retryable: boolean
  title: string
  nextStep: string
}

/** Reports a malformed current-format failure payload at a read boundary. */
export class RunFailureParseError extends TaggedError('RunFailureParseError')<{
  message: string
  cause: unknown
}>() {}

/** Defines the approved cause copy and action for each failure. */
export const RUN_FAILURE_DEFINITIONS = {
  subrequest_limit: {
    category: 'platform_limit',
    retryable: true,
    title: 'The answer got too long for one run.',
    nextStep: 'Try again with a narrower request, or split the task.',
  },
  output_cap_reached: {
    category: 'platform_limit',
    retryable: true,
    title: 'The agent ran out of room before finishing its answer.',
    nextStep: 'Try again with a narrower request, or split the task.',
  },
  run_token_budget_exceeded: {
    category: 'platform_limit',
    retryable: true,
    title: 'The run hit its limit of 2 million tokens.',
    nextStep:
      'Split the task into smaller issues, or narrow its scope, then try again.',
  },
  model_unavailable: {
    category: 'model',
    retryable: true,
    title: "The AI model didn't respond.",
    nextStep: 'Try again in a few minutes.',
  },
  model_retired: {
    category: 'model',
    retryable: false,
    title: 'The AI model this agent uses was retired by its provider.',
    nextStep: 'Ask a workspace admin to choose a new model.',
  },
  tool_failed: {
    category: 'tool',
    retryable: true,
    title: 'A connected tool failed during the run.',
    nextStep: 'Try again.',
  },
  turn_timed_out: {
    category: 'run_lifecycle',
    retryable: true,
    title: 'The run took too long and was stopped.',
    nextStep: 'Try again, or split the task.',
  },
  turn_ended_without_resolution: {
    category: 'run_lifecycle',
    retryable: false,
    title:
      'The agent finished without completing the task or asking a question.',
    nextStep: 'Add more detail to the task and run it again.',
  },
  no_resolution: {
    category: 'run_lifecycle',
    retryable: false,
    title:
      'The agent finished without completing the task or asking a question.',
    nextStep: 'Add more detail to the task and run it again.',
  },
  no_output: {
    category: 'run_lifecycle',
    retryable: false,
    title: 'The automation finished without producing any output.',
    nextStep:
      "Add more detail to the automation's instructions and run it again.",
  },
  brain_output_authority_denied: {
    category: 'permissions',
    retryable: false,
    title: "The agent wasn't allowed to save its results.",
    nextStep: "Ask a workspace admin to check the agent's permissions.",
  },
  approval_stale: {
    category: 'approval',
    retryable: true,
    title: 'The run waited too long for approval and was closed.',
    nextStep: "Start the run again when you're ready to approve.",
  },
  turn_aborted: {
    category: 'unknown',
    retryable: true,
    title: 'The run stopped for an unexpected reason.',
    nextStep: 'Try again. If it keeps happening, tell your workspace admin.',
  },
  turn_skipped: {
    category: 'unknown',
    retryable: true,
    title: 'The run stopped for an unexpected reason.',
    nextStep: 'Try again. If it keeps happening, tell your workspace admin.',
  },
  workflow_ended_with_live_run: {
    category: 'unknown',
    retryable: true,
    title: 'The run stopped for an unexpected reason.',
    nextStep: 'Try again. If it keeps happening, tell your workspace admin.',
  },
  workflow_start_failed: {
    category: 'unknown',
    retryable: true,
    title: 'The run stopped for an unexpected reason.',
    nextStep: 'Try again. If it keeps happening, tell your workspace admin.',
  },
  unknown: {
    category: 'unknown',
    retryable: true,
    title: 'The run stopped for an unexpected reason.',
    nextStep: 'Try again. If it keeps happening, tell your workspace admin.',
  },
} satisfies Record<RunFailureCause, RunFailureDefinition>

const LEGACY_RUN_FAILURE_CAUSES = {
  timeout: 'turn_timed_out',
  tool_timeout: 'tool_failed',
  stale_approval: 'approval_stale',
  automation_completed_without_output: 'no_output',
} satisfies Record<string, RunFailureCause>

const CONNECTOR_FAILURE_KINDS = {
  transient: 'other',
  auth_expired: 'auth',
  permission_denied: 'permission',
  rate_limited: 'rate_limit',
  not_found: 'other',
  unknown: 'other',
} satisfies Record<
  ConnectorError['kind'],
  NonNullable<PublicRunFailure['context']>['connectorErrorKind']
>

/** Creates a typed run failure from a known cause and safe context. */
export function runFailure(
  cause: RunFailureCause,
  context?: PublicRunFailure['context'],
): RunFailure {
  return publicRunFailureSchema.parse({
    cause,
    ...(context ? { context } : {}),
  })
}

/** Removes private diagnostics before a failure crosses a storage or API boundary. */
export function toPublicRunFailure(failure: RunFailure): PublicRunFailure {
  return publicRunFailureSchema.parse({
    cause: failure.cause,
    ...(failure.context ? { context: failure.context } : {}),
  })
}

function legacyCause(value: unknown): RunFailureCause | null {
  if (typeof value !== 'string') return null
  const parsed = runFailureCauseSchema.safeParse(value)
  if (parsed.success) return parsed.data
  return Object.hasOwn(LEGACY_RUN_FAILURE_CAUSES, value)
    ? LEGACY_RUN_FAILURE_CAUSES[value as keyof typeof LEGACY_RUN_FAILURE_CAUSES]
    : null
}

/** Reads current and legacy failure payloads without retaining raw error text. */
export function parseRunFailure(
  payload: unknown,
): Result<PublicRunFailure, RunFailureParseError> {
  const source = publicRunFailureSchema.safeParse(payload)
  if (source.success) return Result.ok(source.data)

  const recordResult = z.record(z.string(), z.unknown()).safeParse(payload)
  if (recordResult.success) {
    const record = recordResult.data
    const nested = publicRunFailureSchema.safeParse(record.failure)
    if (nested.success) return Result.ok(nested.data)
    if (record.failure !== undefined) {
      return Result.err(
        new RunFailureParseError({
          message: 'Invalid structured run failure payload.',
          cause: nested.error,
        }),
      )
    }

    const cause =
      legacyCause(record.reason) ??
      legacyCause(record.error) ??
      legacyCause(record.message) ??
      legacyCause(record.cause)
    if (cause) return Result.ok({ cause })
  }

  const cause = legacyCause(payload)
  return Result.ok({ cause: cause ?? 'unknown' })
}

/** Returns approved user copy for a run failure. */
export function describeRunFailure(
  failure: PublicRunFailure,
): RunFailureDefinition {
  const definition = RUN_FAILURE_DEFINITIONS[failure.cause]
  if (failure.cause !== 'tool_failed') return definition

  const connectorName = failure.context?.connectorName
  const connectorErrorKind = failure.context?.connectorErrorKind
  const title = connectorName
    ? `${connectorName} failed during the run.`
    : 'A connected tool failed during the run.'
  const nextStep =
    connectorErrorKind === 'auth' && connectorName
      ? `Reconnect ${connectorName} in Connectors.`
      : connectorErrorKind === 'permission' && connectorName
        ? `Check what ${connectorName} is allowed to access.`
        : connectorErrorKind === 'rate_limit'
          ? 'Wait a few minutes and try again.'
          : 'Try again.'
  return { ...definition, title, nextStep }
}

/** Classifies a generic run signal with ordered runtime-specific matchers. */
export function classifyRunFailure(
  signal: RunFailureSignal,
  matchers: readonly RunFailureMatcher[],
): RunFailure {
  const matched = matchers.find((matcher) => matcher.matches(signal))
  const explicitCause = runFailureCauseSchema.safeParse(signal.error)
  const cause =
    matched?.cause ??
    (explicitCause.success
      ? explicitCause.data
      : signal.toolError
        ? 'tool_failed'
        : 'unknown')
  const toolError = signal.toolError
  const connectorErrorKind = toolError?.kind
    ? CONNECTOR_FAILURE_KINDS[toolError.kind]
    : undefined
  const context: PublicRunFailure['context'] = toolError
    ? {
        ...(toolError.connectorId
          ? { connectorId: toolError.connectorId }
          : {}),
        ...(toolError.connectorName
          ? { connectorName: toolError.connectorName }
          : {}),
        ...(toolError.toolName ? { toolName: toolError.toolName } : {}),
        ...(connectorErrorKind ? { connectorErrorKind } : {}),
      }
    : undefined
  const diagnostic =
    signal.error instanceof Error
      ? signal.error.message
      : typeof signal.error === 'string'
        ? signal.error
        : undefined
  return {
    ...runFailure(cause, context),
    ...(diagnostic ? { diagnostic } : {}),
  }
}

/** Formats a run failure as one user-facing sentence pair: title, then next step. */
export function formatRunFailure(failure: PublicRunFailure): string {
  const { title, nextStep } = describeRunFailure(failure)
  return `${title} ${nextStep}`
}
