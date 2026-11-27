import { Result, TaggedError } from 'better-result'

export class IssueBrainAudienceError extends TaggedError(
  'IssueBrainAudienceError',
)<{
  code: 'invalid_state' | 'runtime_failed'
  message: string
  cause?: unknown
}>() {}

/**
 * Proves that retained Think history belongs to this issue's shared audience
 * before a shared issue run may resume it.
 *
 * Before (garden#143): issue runs read Brain context as the agent owner, so
 * owner-private memory could enter the Think transcript. A later turn on the
 * same issue facet replayed that transcript into output every workspace
 * member can see.
 *
 * After: a facet is trusted only when its config carries the stamp
 * `org-v1:<workspaceId>`, written when the facet starts empty under the
 * org-only audience. A stamped facet resumes normally. An unstamped facet with
 * any durable history (a legacy facet, or one created before this fix) is
 * refused with `invalid_state`; its history is retained but never replayed.
 * An unstamped empty facet is stamped only on the Workflow start/resume path
 * (`initializeEmpty`), before its first turn is persisted. A failed history
 * read or stamp write is `runtime_failed`, so the run stops rather than
 * guessing.
 *
 * The caller must read durable session history (`session.getHistory()`),
 * never Think's in-memory message cache. In @cloudflare/think 0.10.0
 * (`dist/think-BYZXQ-vm.js`, the `transcript-hydration` start step) a failed
 * hydration replaces the cache with `[]` while persisted history is
 * untouched, and `session.getHistory()` reads the full persisted path
 * (`dist/think-i1Pkgb1R.d.ts`, hydration byte budget docs). An empty cache is
 * therefore not proof of an empty facet.
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
