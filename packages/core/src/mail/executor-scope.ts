const GARDEN_MAIL_EXECUTOR_TOOLKIT_PATTERN =
  /^garden-mail-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validates the only toolkit namespace Garden Mail may provision. */
export const isGardenMailExecutorToolkit = (slug: string) =>
  GARDEN_MAIL_EXECUTOR_TOOLKIT_PATTERN.test(slug)

/**
 * Gives one member/agent authority one deterministic Executor toolkit.
 * The first 128 digest bits are formatted as a UUID-shaped opaque identifier
 * so producer and Executor host share one canonical namespace contract.
 */
export const gardenMailExecutorToolkitSlug = async (input: {
  readonly workspaceId: string
  readonly userId: string
  readonly agentId: string
}) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        `${input.workspaceId}\n${input.userId}\n${input.agentId}`,
      ),
    ),
  )
  const hex = Array.from(digest.slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return `garden-mail-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
