/**
 * Small helpers shared by the agent runtime's Durable Objects and tools. They
 * used to be copied into each file that needed them; keeping one copy means
 * the sandbox id scheme and terminal-status set cannot drift between agents.
 */

/** Message text for any thrown value. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The `"<operation> failed: <cause>"` message used by every database and
 * dispatch error wrapper in the runtime.
 */
export function operationFailedMessage(operation: string, cause: unknown) {
  return `${operation} failed: ${errorMessage(cause)}`
}

/** Returns a plain object, or null for arrays, primitives and null. */
export function objectOrNull(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Think submission statuses after which a turn will not run again. */
export const TERMINAL_SUBMISSION_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'aborted',
  'skipped',
  'error',
])

export function isTerminalSubmissionStatus(status: string) {
  return TERMINAL_SUBMISSION_STATUSES.has(status)
}

const MAX_SANDBOX_ID_LENGTH = 63

/**
 * Builds the sandbox id for an agent or facet. Short facet paths are used as
 * is; long ones are compacted to `<parent>-<name>-<hash>` so the id stays
 * within the sandbox's 63-character limit while remaining stable per facet.
 */
export function agentSandboxId(input: {
  selfPath: ReadonlyArray<{ name: string }>
  parentPath: ReadonlyArray<{ name: string }>
  name: string
}) {
  const pathKey = input.selfPath.map((segment) => segment.name).join('-')
  const candidate = pathKey || input.name
  if (candidate.length <= MAX_SANDBOX_ID_LENGTH) {
    return candidate
  }

  return [
    compactSandboxSegment(input.parentPath.at(-1)?.name || 'agent-do', 20),
    compactSandboxSegment(input.name, 20),
    hashSandboxId(candidate),
  ].join('-')
}

function compactSandboxSegment(value: string, maxLength: number) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!normalized) {
    return 'sandbox'
  }

  return normalized.slice(0, maxLength)
}

/** 32-bit FNV-1a hash, hex encoded. */
function hashSandboxId(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16)
}
