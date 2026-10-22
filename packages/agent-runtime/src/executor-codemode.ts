import { Result } from 'better-result'
import {
  extractExecutorToolRefs,
  type ExecutorToolRef,
} from '@garden/connectors/capabilities'

export { extractExecutorToolRefs, type ExecutorToolRef }

export type ExecutorFailureStage =
  | 'file_read'
  | 'mcp_handoff'
  | 'decide_analysis'
  | 'transport_timeout'
  | 'result_parsing'
  | 'unknown'

export type ExecutorToolFailure = {
  stage: ExecutorFailureStage
  message: string
  code?: string
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
  if (input.refs.length > 0 || lowerToolName.includes('executor')) {
    return 'mcp_handoff'
  }
  return 'unknown'
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
  const executionResult =
    recordValue(structured?.result) ?? recordValue(outputRecord?.result)
  const nestedError = recordValue(executionResult?.error)
  const failedEnvelope =
    outputRecord?.isError === true ||
    outputRecord?.ok === false ||
    structured?.status === 'error' ||
    executionResult?.ok === false
  const message =
    errorMessage(input.error) ??
    (failedEnvelope ? errorMessage(structured?.error) : null) ??
    (failedEnvelope ? errorMessage(outputRecord?.error) : null) ??
    (failedEnvelope ? errorMessage(nestedError) : null) ??
    (failedEnvelope ? textFromContent(outputRecord?.content) : null)
  if (!message) return null

  const code =
    typeof structured?.errorCode === 'string'
      ? structured.errorCode
      : typeof outputRecord?.code === 'string'
        ? outputRecord.code
        : typeof nestedError?.code === 'string'
          ? nestedError.code
          : undefined

  return {
    ...(code ? { code } : {}),
    message,
    stage: failureStage({ message, refs, toolName: input.toolName }),
  }
}
