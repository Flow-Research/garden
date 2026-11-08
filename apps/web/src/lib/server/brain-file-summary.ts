import { DateTime, Effect, Result as EffectResult } from 'effect'
import { inArray } from 'drizzle-orm'
import { ItemId, WorkspaceId, type BrainItem } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
import { makeWebBrainLive } from '@garden/brain/services/web'
import type { BrainFileSummary } from '@/features/brain/contract'
import { brainFileStatusOf } from '@/features/brain/contract'
import { getDb, schema } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'

/**
 * Maps a Helix brain item to the public file summary. Upload time comes from
 * `origin.at` (set at staging); the uploader's display name comes from the
 * human actor's user id, resolved by `loadBrainFileOwnerNames`.
 */
export function brainFileSummaryOf(
  item: BrainItem,
  ownerNames?: ReadonlyMap<string, string>,
): BrainFileSummary {
  const uploadedAt = DateTime.toDate(item.origin.at).toISOString()
  const actor = item.origin.actor
  const createdByName =
    actor._tag === 'Human' ? ownerNames?.get(actor.userId) : undefined

  return {
    id: item.id,
    name: item.label,
    status: brainFileStatusOf(item),
    uploadedAt,
    ...(item.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}),
    ...(createdByName ? { createdByName } : {}),
  }
}

/**
 * Batch-resolves display names ("Made by …") for the human actors behind a
 * set of brain items. Profiles without a name fall back to their email.
 */
export async function loadBrainFileOwnerNames(args: {
  env: Pick<AppEnv, 'HYPERDRIVE'>
  items: readonly BrainItem[]
}): Promise<Map<string, string>> {
  const userIds = [
    ...new Set(
      args.items.flatMap((item) =>
        item.origin.actor._tag === 'Human' ? [item.origin.actor.userId] : [],
      ),
    ),
  ]
  if (userIds.length === 0) return new Map()

  const db = await getDb(args.env)
  const rows = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.user)
    .where(inArray(schema.user.id, userIds))

  return new Map(
    rows.map((row) => [row.id, row.name.trim() || row.email] as const),
  )
}

export type BrainItemsByIdsResult =
  | { status: 'ok'; items: BrainItem[] }
  | { status: 'unconfigured' }
  | { status: 'unavailable' }

/**
 * Resolves brain file items by id, for folder membership. Filtering
 * `Brain.listFiles` silently dropped members past its 100-file cap; id
 * lookups are exact and uncapped. Deleted files resolve to null and drop
 * out. One bad read fails the whole batch (route answers 503) rather than
 * rendering a partial folder as authoritative.
 */
export async function loadBrainItemsByIds(args: {
  env: AppEnv
  workspaceId: string
  fileIds: readonly string[]
}): Promise<BrainItemsByIdsResult> {
  const helixUrl = args.env.HELIX_URL
  if (helixUrl === undefined) return { status: 'unconfigured' }

  const brainLive = makeWebBrainLive({
    baseUrl: helixUrl,
    apiKey: args.env.HELIX_API_KEY,
    ai: args.env.AI,
    files: args.env.BRAIN_FILES,
  })
  const tenantId = WorkspaceId.make(args.workspaceId)

  const result = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(Brain, (brain) =>
        Effect.forEach(
          args.fileIds,
          (fileId) => brain.readFileItem(ItemId.make(fileId), tenantId),
          { concurrency: 5 },
        ),
      ).pipe(Effect.provide(brainLive)),
    ),
  )
  if (EffectResult.isFailure(result)) return { status: 'unavailable' }

  return {
    status: 'ok',
    items: result.success.filter((item) => item !== null),
  }
}
