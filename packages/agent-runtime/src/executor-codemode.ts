import { Result } from 'better-result'
import {
  extractExecutorToolRefs,
  type ExecutorToolRef,
} from '@garden/connectors/capabilities'

export { extractExecutorToolRefs, type ExecutorToolRef }

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
