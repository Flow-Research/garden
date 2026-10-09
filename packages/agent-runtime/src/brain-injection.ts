import { Effect } from 'effect'
import { WorkspaceId } from '@garden/brain/domain'
import { selectInjection } from '@garden/brain/services/selection'
import type { ScopeViewer } from '@garden/brain/domain/scope'
import { Brain } from '@garden/brain/services/brain'
import type { SearchHit } from '@garden/brain/domain'
import { makeWorkerBrainLive } from '@garden/brain/services/worker'
import type { WorkersAiBinding } from '@garden/brain/services/embeddings'
import type { R2BucketLike } from '@garden/brain/services/raw-file-store'

const INJECTION_K = 6
const INJECTION_MIN_TOP = 0.02
const INJECTION_RELATIVE_FLOOR = 0.6

export type BrainInjection = {
  readonly text: string
  readonly itemIds: readonly string[]
  readonly hitCount: number
}

const emptyInjection: BrainInjection = { text: '', itemIds: [], hitCount: 0 }

/** Pulls the most recent user text out of the assembled model messages. */
export function latestUserText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: unknown }
    if (message?.role !== 'user') continue
    const content = message.content
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (part): part is { type: string; text: string } =>
            typeof part === 'object' &&
            part !== null &&
            (part as { type?: unknown }).type === 'text' &&
            typeof (part as { text?: unknown }).text === 'string',
        )
        .map((part) => part.text)
        .join(' ')
        .trim()
      if (text !== '') return text
    }
  }
  return ''
}

const observedAtOf = (hit: SearchHit): string | undefined => {
  const at = hit.item.origin.at
  if (at === undefined) return undefined
  return typeof at === 'string' ? at : String(at)
}

/**
 * Fetches a small, scoped set of brain items for the current turn and formats
 * a compact memory block. Returns an empty block on any failure so a turn never
 * breaks because the brain is unavailable.
 */
export async function loadBrainInjection(args: {
  readonly env: { HELIX_URL?: string; HELIX_API_KEY?: string }
  readonly ai: WorkersAiBinding
  readonly files: R2BucketLike
  readonly workspaceId: string
  readonly viewer: ScopeViewer
  readonly query: string
  readonly log?: (event: Record<string, unknown>) => void
}): Promise<BrainInjection> {
  const query = args.query.trim()
  if (args.env.HELIX_URL === undefined || query === '') return emptyInjection

  const layer = makeWorkerBrainLive({
    baseUrl: args.env.HELIX_URL,
    apiKey: args.env.HELIX_API_KEY,
    ai: args.ai,
    files: args.files,
  })

  const hits = await Effect.runPromise(
    Effect.flatMap(Brain, (brain) =>
      brain.search({
        tenantId: WorkspaceId.make(args.workspaceId),
        query,
        k: INJECTION_K,
        viewer: args.viewer,
      }),
    ).pipe(
      Effect.provide(layer),
      Effect.catch(() => Effect.succeed([] as readonly SearchHit[])),
    ),
  )

  const topScore = hits.reduce(
    (max, hit) => Math.max(max, hit.rankScore ?? hit.score),
    0,
  )
  if (hits.length === 0 || topScore < INJECTION_MIN_TOP) {
    args.log?.({
      event: 'brain.injection.empty',
      query,
      hitCount: hits.length,
      topScore,
    })
    return { ...emptyInjection, hitCount: hits.length }
  }

  const relevanceFloor = topScore * INJECTION_RELATIVE_FLOOR
  const selected = selectInjection({
    anchors: [],
    hits: hits.map((hit) => ({
      item: {
        id: hit.item.id,
        label: hit.item.label,
        ...(hit.item.summary === undefined
          ? {}
          : { summary: hit.item.summary }),
        ...(observedAtOf(hit) === undefined
          ? {}
          : { observedAt: observedAtOf(hit) }),
      },
      score: hit.rankScore ?? hit.score,
    })),
    maxAnchors: 0,
    maxItems: INJECTION_K,
    relevanceFloor,
  })

  if (selected.length === 0) {
    args.log?.({ event: 'brain.injection.empty', query, hitCount: hits.length })
    return { ...emptyInjection, hitCount: hits.length }
  }

  const lines = selected.map((item, index) => {
    const summary = item.summary === undefined ? '' : `: ${item.summary}`
    return `${index + 1}. [${item.id}] ${item.label}${summary}`
  })
  const text = [
    'Org Brain memory for this turn. Scoped to what the asker may see, and it may be stale. Confirm against live tools when it matters.',
    ...lines,
    'Call brain_search or brain_neighborhood with an id above for more.',
  ].join('\n')

  args.log?.({
    event: 'brain.injection.found',
    query,
    hitCount: hits.length,
    injectedCount: selected.length,
    topScore,
    relevanceFloor,
    itemIds: selected.map((item) => item.id),
  })

  return {
    text,
    itemIds: selected.map((item) => item.id),
    hitCount: hits.length,
  }
}
