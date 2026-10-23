import { Effect, Result, Schema } from 'effect'
import { ToolAddress } from '@executor-js/sdk/core'
import {
  executorProgram,
  type ExecutorIdentity,
  type GardenExecutor,
} from '@/lib/server/executor-runtime'

export type DecideDiagnosticStage =
  | 'catalog'
  | 'connection'
  | 'tool_lookup'
  | 'mcp_handoff'
  | 'authentication'
  | 'tool_call'
  | 'result_parsing'

export type DecideDiagnosticCheck = {
  name: 'catalog' | 'connection' | 'tool' | 'call'
  outcome: 'passed' | 'failed'
  stage: DecideDiagnosticStage
  message: string
  code?: string
  status?: number
  mcpCode?: number
  transportFailure?: boolean
  correlationId?: string
}

export type DecideDiagnosticReport = {
  diagnosticId: string
  integration: 'decide'
  tool: 'whoami'
  outcome: 'passed' | 'failed'
  checks: readonly DecideDiagnosticCheck[]
  durationMs: number
}

type RecordValue = Record<string, unknown>

const asRecord = (value: unknown): RecordValue | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null

const textValue = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

const correlationIdFrom = (message: string | null) =>
  message?.match(/\[([0-9a-f]{8})\]$/i)?.[1] ?? undefined

const failureFromValue = (
  value: unknown,
): Omit<DecideDiagnosticCheck, 'name' | 'outcome' | 'stage'> | null => {
  const record = asRecord(value)
  if (!record) return null

  const error = asRecord(record.error)
  const nested = asRecord(record.cause)
  const message =
    textValue(error?.message) ??
    textValue(error?.error) ??
    textValue(record.message) ??
    textValue(nested?.message)
  if (!message) return null

  const code =
    textValue(error?.code) ??
    textValue(record.code) ??
    textValue(nested?.code) ??
    undefined
  const status =
    typeof error?.status === 'number'
      ? error.status
      : typeof record.status === 'number'
        ? record.status
        : typeof nested?.status === 'number'
          ? nested.status
          : undefined
  const mcpCode =
    typeof error?.mcpCode === 'number'
      ? error.mcpCode
      : typeof record.mcpCode === 'number'
        ? record.mcpCode
        : typeof nested?.mcpCode === 'number'
          ? nested.mcpCode
          : undefined
  const transportFailure =
    typeof error?.transportFailure === 'boolean'
      ? error.transportFailure
      : typeof record.transportFailure === 'boolean'
        ? record.transportFailure
        : typeof nested?.transportFailure === 'boolean'
          ? nested.transportFailure
          : undefined

  return {
    message,
    ...(code ? { code } : {}),
    ...(status === undefined ? {} : { status }),
    ...(mcpCode === undefined ? {} : { mcpCode }),
    ...(transportFailure === undefined ? {} : { transportFailure }),
    ...(correlationIdFrom(message)
      ? { correlationId: correlationIdFrom(message) }
      : {}),
  }
}

const failureFromError = (
  value: unknown,
  fallbackStage: DecideDiagnosticStage,
) => {
  const record = asRecord(value)
  const nested = record?.cause
  const tagged = asRecord(nested)
  const providerFailure = failureFromValue(nested)
  if (tagged?._tag === 'McpInvocationError' && providerFailure) {
    return {
      ...providerFailure,
      stage:
        providerFailure.status === 401 || providerFailure.status === 403
          ? ('authentication' as const)
          : ('mcp_handoff' as const),
    }
  }

  const failure = failureFromValue(value)
  if (!failure) return null
  return {
    ...failure,
    stage:
      record?._tag === 'CredentialResolutionError'
        ? ('authentication' as const)
        : fallbackStage,
  }
}

const failedCheck = (
  name: DecideDiagnosticCheck['name'],
  failure: {
    stage: DecideDiagnosticStage
    message: string
    code?: string
    status?: number
    mcpCode?: number
    transportFailure?: boolean
    correlationId?: string
  },
): DecideDiagnosticCheck => ({
  name,
  outcome: 'failed',
  ...failure,
})

const passedCheck = (
  name: DecideDiagnosticCheck['name'],
  stage: DecideDiagnosticStage,
  message: string,
): DecideDiagnosticCheck => ({
  name,
  outcome: 'passed',
  stage,
  message,
})

const report = (input: {
  diagnosticId: string
  startedAt: number
  checks: readonly DecideDiagnosticCheck[]
}): DecideDiagnosticReport => ({
  diagnosticId: input.diagnosticId,
  integration: 'decide',
  tool: 'whoami',
  outcome: input.checks.every((check) => check.outcome === 'passed')
    ? 'passed'
    : 'failed',
  checks: input.checks,
  durationMs: Date.now() - input.startedAt,
})

/**
 * Runs a small, deterministic Decide health check through the Executor SDK.
 * Chat previously tested Decide through generated code, which collapsed
 * catalog, handoff, provider, and parsing failures into one chat error. This
 * function checks the live catalog, connection, and `whoami` tool separately.
 * It returns safe metadata only and never returns the provider identity.
 */
export function diagnoseDecideWithExecutor(
  executor: GardenExecutor,
): Effect.Effect<DecideDiagnosticReport> {
  return Effect.gen(function* () {
    const diagnosticId = crypto.randomUUID()
    const startedAt = Date.now()
    const catalogResult = yield* Effect.result(
      Effect.all({
        integrations: executor.integrations.list(),
        connections: executor.connections.list(),
        tools: executor.tools.list({
          includeBlocked: true,
          includeAnnotations: true,
        }),
      }),
    )

    if (Result.isFailure(catalogResult)) {
      const failure = failureFromError(catalogResult.failure, 'catalog') ?? {
        stage: 'catalog' as const,
        message: 'Executor catalog could not be loaded.',
      }
      return report({
        diagnosticId,
        startedAt,
        checks: [failedCheck('catalog', failure)],
      })
    }

    const { connections, tools } = catalogResult.success
    const decideConnections = connections.filter(
      (connection) => String(connection.integration) === 'decide',
    )
    const catalogCheck = passedCheck(
      'catalog',
      'catalog',
      `Executor catalog loaded with ${catalogResult.success.tools.length} tools.`,
    )
    if (decideConnections.length === 0) {
      return report({
        diagnosticId,
        startedAt,
        checks: [
          catalogCheck,
          failedCheck('connection', {
            stage: 'connection',
            message: 'No Decide connection is available for this account.',
          }),
        ],
      })
    }

    const connectionCheck = passedCheck(
      'connection',
      'connection',
      `Found ${decideConnections.length} Decide connection${decideConnections.length === 1 ? '' : 's'}.`,
    )
    const whoami = tools.find(
      (tool) =>
        String(tool.integration) === 'decide' &&
        String(tool.name).toLowerCase() === 'whoami',
    )
    if (!whoami) {
      return report({
        diagnosticId,
        startedAt,
        checks: [
          catalogCheck,
          connectionCheck,
          failedCheck('tool', {
            stage: 'tool_lookup',
            message:
              'The connected Decide server does not expose a whoami tool.',
          }),
        ],
      })
    }

    const addressResult = yield* Effect.result(
      Schema.decodeUnknownEffect(ToolAddress)(String(whoami.address)),
    )
    if (Result.isFailure(addressResult)) {
      return report({
        diagnosticId,
        startedAt,
        checks: [
          catalogCheck,
          connectionCheck,
          failedCheck('tool', {
            stage: 'tool_lookup',
            message: 'The Decide whoami tool has an invalid address.',
          }),
        ],
      })
    }

    const callResult = yield* Effect.result(
      executor.execute(
        addressResult.success,
        {},
        { onElicitation: 'accept-all' },
      ),
    )
    if (Result.isFailure(callResult)) {
      const failure = failureFromError(callResult.failure, 'mcp_handoff') ?? {
        stage: 'mcp_handoff' as const,
        message: 'The Decide whoami call failed before it returned a result.',
      }
      return report({
        diagnosticId,
        startedAt,
        checks: [
          catalogCheck,
          connectionCheck,
          passedCheck('tool', 'tool_lookup', 'Found the Decide whoami tool.'),
          failedCheck('call', failure),
        ],
      })
    }

    const returnedFailure = failureFromValue(callResult.success)
    if (returnedFailure) {
      return report({
        diagnosticId,
        startedAt,
        checks: [
          catalogCheck,
          connectionCheck,
          passedCheck('tool', 'tool_lookup', 'Found the Decide whoami tool.'),
          failedCheck('call', {
            ...returnedFailure,
            stage: 'tool_call',
          }),
        ],
      })
    }

    return report({
      diagnosticId,
      startedAt,
      checks: [
        catalogCheck,
        connectionCheck,
        passedCheck('tool', 'tool_lookup', 'Found the Decide whoami tool.'),
        passedCheck(
          'call',
          'tool_call',
          'Decide whoami returned successfully.',
        ),
      ],
    })
  })
}

/** Runs the deterministic Decide diagnostic inside Garden's normal Executor
 * tenant and subject boundary. The route and chat diagnostics therefore use
 * the same stored connection and OAuth scope as a real user request. */
export const diagnoseDecide = (identity: ExecutorIdentity) =>
  executorProgram(identity, diagnoseDecideWithExecutor)
