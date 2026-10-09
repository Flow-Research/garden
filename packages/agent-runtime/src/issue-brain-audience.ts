import { Result, TaggedError } from 'better-result'

export class IssueBrainAudienceError extends TaggedError(
  'IssueBrainAudienceError',
)<{
  code: 'invalid_state' | 'runtime_failed'
  message: string
  cause?: unknown
}>() {}

/**
 * Proves that retained Think history belongs to this issue's shared audience.
 * The caller must read durable session history, never Think's hydration cache:
 * the SDK deliberately makes that cache empty when startup hydration fails.
 */
export async function ensureIssueBrainAudience(input: {
  workspaceId: string
  initializeEmpty: boolean
  config: { brainAudience?: unknown } | null
  readDurableHistory: () => Promise<readonly unknown[]>
  persistAudience: (audience: string) => void
}) {
  const expected = `org-v1:${input.workspaceId}`
  if (input.config?.brainAudience === expected) return Result.ok(undefined)
  const history = await Result.tryPromise({
    try: input.readDurableHistory,
    catch: (cause) =>
      new IssueBrainAudienceError({
        code: 'runtime_failed',
        message: 'Cannot verify issue Brain audience history.',
        cause,
      }),
  })
  if (history.isErr()) return Result.err(history.error)
  if (
    input.config !== null ||
    !input.initializeEmpty ||
    history.value.length !== 0
  ) {
    return Result.err(
      new IssueBrainAudienceError({
        code: 'invalid_state',
        message:
          'Issue transcript has an unverified Brain audience. Use a new issue with reviewed shared context; retained history cannot be resumed.',
      }),
    )
  }
  return Result.try({
    try: () => input.persistAudience(expected),
    catch: (cause) =>
      new IssueBrainAudienceError({
        code: 'runtime_failed',
        message: 'Cannot persist issue Brain audience.',
        cause,
      }),
  })
}
