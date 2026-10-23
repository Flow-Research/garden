import { Result } from 'better-result'
import {
  extractExecutorToolRefs,
  type ExecutorToolRef,
} from '@garden/connectors/capabilities'

export { extractExecutorToolRefs, type ExecutorToolRef }

export type ExecutorFailureStage =
  | 'configuration'
  | 'discovery'
  | 'authentication'
  | 'file_read'
  | 'data_handoff'
  | 'transport'
  | 'mcp_handoff'
  | 'decide_analysis'
  | 'transport_timeout'
  | 'result_parsing'
  | 'generated_file'
  | 'session'
  | 'unknown'

export type ExecutorFailureKind =
  | 'authentication'
  | 'insufficient_credits'
  | 'transport'
  | 'transport_timeout'
  | 'provider_error'
  | 'result_parsing'
  | 'unknown'

export type ExecutorFailureAction =
  | 'none'
  | 'retry'
  | 'reconnect'
  | 'add_credits'
  | 'select_file'
  | 'start_new_session'
  | 'contact_support'

export type ExecutorToolFailure = {
  stage: ExecutorFailureStage
  kind?: ExecutorFailureKind
  message: string
  code?: string
  status?: number
  mcpCode?: number
  transportFailure?: boolean
  transportKind?: 'timeout' | 'dns' | 'tls' | 'http' | 'connection' | 'unknown'
  transportMessage?: string
  retryable?: boolean
  userAction?: ExecutorFailureAction
}

function serializedInput(input: unknown): string {
  return Result.try({
    try: () => JSON.stringify(input) ?? '',
    catch: () => '',
  }).unwrapOr('')
}

export function extractExecutorToolRefsFromInput(
  input: unknown,
): ExecutorToolRef[] {
  if (typeof input === 'string') return extractExecutorToolRefs(input)
  if (input && typeof input === 'object') {
    return extractExecutorToolRefs(serializedInput(input))
  }
  return []
}

export function mentionsUnparsedExecutorTools(input: unknown): boolean {
  const serialized =
    typeof input === 'string'
      ? input
      : input && typeof input === 'object'
        ? serializedInput(input)
        : ''
  return (
    serialized.includes('tools.') &&
    extractExecutorToolRefs(serialized).length === 0
  )
}

/** Returns an object value for safe inspection of an Executor response. */
function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Extracts a usable error message from the known MCP error shapes. */
function errorMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  const record = recordValue(value)
  if (!record) return null
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim()
  }
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error.trim()
  }
  return null
}

/** Joins text blocks in response order without reading non-text content. */
function textFromContent(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const text = value
    .map((block) => {
      const record = recordValue(block)
      return record?.type === 'text' && typeof record.text === 'string'
        ? record.text.trim()
        : ''
    })
    .filter(Boolean)
    .join('\n')
  return text || null
}

/**
 * Maps safe Executor error metadata to one user action. The default is to stop
 * because a selected MCP tool may already have started work upstream.
 */
function failureAction(input: {
  code?: string
  status?: number
  transportKind?: ExecutorToolFailure['transportKind']
}): ExecutorFailureAction {
  if (input.code === 'insufficient_credits') return 'add_credits'
  if (input.status === 401 || input.status === 403) return 'reconnect'
  if (input.transportKind === 'dns' || input.transportKind === 'tls') {
    return 'contact_support'
  }
  return 'none'
}

/**
 * Classifies a failure from structured MCP metadata. Message matching remains
 * only for older envelopes that predate the structured fields.
 */
function failureKind(input: {
  message: string
  code?: string
  status?: number
  transportKind?: ExecutorToolFailure['transportKind']
  transportFailure?: boolean
}): ExecutorFailureKind {
  if (input.code === 'insufficient_credits') return 'insufficient_credits'
  if (input.status === 401 || input.status === 403) return 'authentication'
  if (input.transportFailure || input.transportKind) {
    return input.transportKind === 'timeout' ? 'transport_timeout' : 'transport'
  }
  const lowerMessage = input.message.toLowerCase()
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('deadline') ||
    lowerMessage.includes('abort')
  ) {
    return 'transport_timeout'
  }
  if (
    lowerMessage.includes('parse') ||
    lowerMessage.includes('invalid json') ||
    lowerMessage.includes('content block')
  ) {
    return 'result_parsing'
  }
  return 'provider_error'
}

/** Maps an Executor failure to the stage that best explains its origin. */
function failureStage(input: {
  toolName?: string
  refs: readonly ExecutorToolRef[]
  message: string
}): ExecutorFailureStage {
  const lowerMessage = input.message.toLowerCase()
  const lowerToolName = input.toolName?.toLowerCase() ?? ''
  if (
    lowerToolName.includes('read') &&
    (lowerToolName.includes('document') || lowerToolName.includes('file'))
  ) {
    return 'file_read'
  }
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('deadline') ||
    lowerMessage.includes('abort')
  ) {
    return 'transport_timeout'
  }
  if (
    lowerMessage.includes('parse') ||
    lowerMessage.includes('invalid json') ||
    lowerMessage.includes('content block')
  ) {
    return 'result_parsing'
  }
  if (
    input.refs.some((ref) => ref.executorSlug === 'decide') &&
    input.refs.some((ref) => ref.tool.toLowerCase().includes('analy'))
  ) {
    return 'decide_analysis'
  }
  if (lowerToolName.includes('decide_analy')) return 'decide_analysis'
  if (input.refs.length > 0 || lowerToolName.includes('executor')) {
    return 'mcp_handoff'
  }
  return 'unknown'
}

/** Accepts only failure stages that Garden can safely expose to the UI. */
function explicitFailureStage(
  value: unknown,
): ExecutorFailureStage | undefined {
  const stages: readonly ExecutorFailureStage[] = [
    'configuration',
    'discovery',
    'authentication',
    'file_read',
    'data_handoff',
    'transport',
    'mcp_handoff',
    'decide_analysis',
    'transport_timeout',
    'result_parsing',
    'generated_file',
    'session',
    'unknown',
  ]
  return typeof value === 'string' &&
    stages.includes(value as ExecutorFailureStage)
    ? (value as ExecutorFailureStage)
    : undefined
}

/**
 * Reads a failed MCP envelope without changing the envelope returned to the
 * model. Executor reports domain failures in the success channel with
 * `isError` and `structuredContent`; AI SDK tool errors use a thrown error.
 * Keeping both shapes here gives logs, route guards, and the chat UI the same
 * failure stage. No input data or generated file contents are read.
 */
export function extractExecutorToolFailure(input: {
  output?: unknown
  error?: unknown
  toolName?: string
  toolInput?: unknown
}): ExecutorToolFailure | null {
  const refs = extractExecutorToolRefsFromInput(input.toolInput)
  const outputRecord = recordValue(input.output)
  const structured = recordValue(outputRecord?.structuredContent)
  const thrownError = recordValue(input.error)
  const thrownCause = recordValue(thrownError?.cause)
  const thrownData = recordValue(thrownError?.data)
  const executionResult =
    recordValue(structured?.result) ?? recordValue(outputRecord?.result)
  const nestedError =
    recordValue(executionResult?.error) ??
    recordValue(structured?.error) ??
    recordValue(outputRecord?.error) ??
    recordValue(thrownData?.error) ??
    recordValue(thrownCause?.error)
  const details =
    recordValue(nestedError?.details) ??
    recordValue(structured?.details) ??
    recordValue(outputRecord?.details) ??
    recordValue(thrownData?.details) ??
    recordValue(thrownCause?.details) ??
    recordValue(thrownError?.details)
  const failedEnvelope =
    outputRecord?.isError === true ||
    outputRecord?.ok === false ||
    structured?.status === 'error' ||
    executionResult?.ok === false
  const message =
    (failedEnvelope ? errorMessage(structured?.error) : null) ??
    (failedEnvelope ? errorMessage(outputRecord?.error) : null) ??
    (failedEnvelope ? errorMessage(nestedError) : null) ??
    (failedEnvelope ? textFromContent(outputRecord?.content) : null) ??
    errorMessage(thrownData?.error) ??
    errorMessage(thrownCause?.error) ??
    errorMessage(thrownData) ??
    errorMessage(thrownCause) ??
    errorMessage(input.error)
  if (!message) return null

  const code =
    typeof structured?.errorCode === 'string'
      ? structured.errorCode
      : typeof outputRecord?.code === 'string'
        ? outputRecord.code
        : typeof nestedError?.code === 'string'
          ? nestedError.code
          : undefined

  const status =
    typeof details?.status === 'number'
      ? details.status
      : typeof nestedError?.status === 'number'
        ? nestedError.status
        : typeof thrownData?.status === 'number'
          ? thrownData.status
          : typeof thrownCause?.status === 'number'
            ? thrownCause.status
            : typeof thrownError?.status === 'number'
              ? thrownError.status
              : undefined
  const mcpCode =
    typeof details?.mcpCode === 'number'
      ? details.mcpCode
      : typeof nestedError?.mcpCode === 'number'
        ? nestedError.mcpCode
        : typeof thrownData?.mcpCode === 'number'
          ? thrownData.mcpCode
          : typeof thrownCause?.mcpCode === 'number'
            ? thrownCause.mcpCode
            : typeof thrownError?.mcpCode === 'number'
              ? thrownError.mcpCode
              : undefined
  const transportFailure =
    details?.transportFailure === true ||
    nestedError?.transportFailure === true ||
    thrownData?.transportFailure === true ||
    thrownCause?.transportFailure === true ||
    thrownError?.transportFailure === true
  const transportKind =
    details?.transportKind === 'timeout' ||
    details?.transportKind === 'dns' ||
    details?.transportKind === 'tls' ||
    details?.transportKind === 'http' ||
    details?.transportKind === 'connection' ||
    details?.transportKind === 'unknown'
      ? details.transportKind
      : thrownData?.transportKind === 'timeout' ||
          thrownData?.transportKind === 'dns' ||
          thrownData?.transportKind === 'tls' ||
          thrownData?.transportKind === 'http' ||
          thrownData?.transportKind === 'connection' ||
          thrownData?.transportKind === 'unknown'
        ? thrownData.transportKind
        : thrownCause?.transportKind === 'timeout' ||
            thrownCause?.transportKind === 'dns' ||
            thrownCause?.transportKind === 'tls' ||
            thrownCause?.transportKind === 'http' ||
            thrownCause?.transportKind === 'connection' ||
            thrownCause?.transportKind === 'unknown'
          ? thrownCause.transportKind
          : undefined
  const transportMessage =
    errorMessage(details?.transportMessage) ??
    errorMessage(thrownData?.transportMessage) ??
    errorMessage(thrownCause?.transportMessage) ??
    undefined
  const effectiveMessage =
    transportFailure && transportMessage ? transportMessage : message
  const resolvedMcpCode =
    mcpCode ??
    (typeof thrownData?.code === 'number' && thrownData.code < 0
      ? thrownData.code
      : typeof thrownCause?.code === 'number' && thrownCause.code < 0
        ? thrownCause.code
        : typeof thrownError?.code === 'number' && thrownError.code < 0
          ? thrownError.code
          : undefined)
  const resolvedTransportKind =
    transportKind ?? (resolvedMcpCode === -32001 ? 'timeout' : undefined)
  const resolvedTransportFailure =
    transportFailure || resolvedTransportKind !== undefined
  const kind = failureKind({
    message: effectiveMessage,
    code,
    status,
    transportKind: resolvedTransportKind,
    transportFailure: resolvedTransportFailure,
  })
  const stage =
    resolvedTransportKind === 'timeout'
      ? 'transport_timeout'
      : resolvedTransportFailure || resolvedTransportKind
        ? 'transport'
        : (explicitFailureStage(structured?.failureStage) ??
          explicitFailureStage(outputRecord?.failureStage) ??
          failureStage({
            message: effectiveMessage,
            refs,
            toolName: input.toolName,
          }))

  return {
    ...(code ? { code } : {}),
    message: effectiveMessage,
    ...(kind ? { kind } : {}),
    ...(status === undefined ? {} : { status }),
    ...(resolvedMcpCode === undefined ? {} : { mcpCode: resolvedMcpCode }),
    ...(resolvedTransportFailure ? { transportFailure: true } : {}),
    ...(resolvedTransportKind ? { transportKind: resolvedTransportKind } : {}),
    ...(transportMessage ? { transportMessage } : {}),
    retryable: false,
    userAction: failureAction({
      code,
      status,
      transportKind: resolvedTransportKind,
    }),
    stage,
  }
}
