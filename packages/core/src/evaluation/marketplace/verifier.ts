import { Result } from 'better-result'
import { marketplaceGoalSchema, type MarketplaceSnapshot } from './contracts'
import {
  advanceMarketplaceClock,
  applyMarketplaceAction,
  MarketplaceInputError,
} from './environment'

/** Stable JSON comparison lets serialized snapshots reorder keys without changing evidence. */
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => canonical(entry)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

export type MarketplaceVerdict = {
  kind: 'passed' | 'failed'
  failures: string[]
  metrics: {
    appliedActions: number
    rejectedActions: number
    unresolvedCommitments: number
    spent: number
    completionTick?: number
  }
}

/** Replays authoritative mock receipts before scoring; self-reported success cannot pass. */
export function verifyMarketplace(
  initial: MarketplaceSnapshot,
  final: MarketplaceSnapshot,
  goalInput: unknown,
): Result<MarketplaceVerdict, MarketplaceInputError> {
  const parsed = marketplaceGoalSchema.safeParse(goalInput)
  if (!parsed.success)
    return Result.err(
      new MarketplaceInputError({ message: parsed.error.message }),
    )
  if (
    initial.orders.length !== 0 ||
    initial.receipts.length !== 0 ||
    initial.revision !== 0 ||
    initial.tick !== 0
  ) {
    return Result.err(
      new MarketplaceInputError({
        message: 'Verifier requires the untouched initial snapshot',
      }),
    )
  }
  const goal = parsed.data
  const failures: string[] = []
  let rebuilt = structuredClone(initial)
  for (const receipt of final.receipts) {
    const step = advanceMarketplaceClock(rebuilt, receipt.tick).andThen(
      (world) =>
        applyMarketplaceAction(
          world,
          { characterId: receipt.characterId },
          receipt.action,
        ),
    )
    step.match({
      ok: (result) => {
        if (result.replayed || canonical(result.receipt) !== canonical(receipt))
          failures.push('receipt_mismatch')
        rebuilt = result.snapshot
      },
      err: () => {
        failures.push('invalid_receipt')
      },
    })
  }
  advanceMarketplaceClock(rebuilt, final.tick).match({
    ok: (world) => {
      rebuilt = world
    },
    err: () => {
      failures.push('invalid_clock')
    },
  })
  if (canonical(rebuilt) !== canonical(final))
    failures.push('unverified_state_change')
  // Score the reconstructed world, never the unverified final-state claim.
  const order = rebuilt.orders.find((entry) => entry.id === goal.orderId)
  if (!order || order.state !== 'delivered') failures.push('not_delivered')
  if (
    order &&
    (order.buyerId !== goal.buyerId ||
      order.sellerId !== goal.sellerId ||
      order.recipientId !== goal.recipientId ||
      order.itemId !== goal.itemId ||
      order.quantity !== goal.quantity)
  )
    failures.push('wrong_order')
  if (
    order?.deliveredTick !== undefined &&
    order.deliveredTick > goal.deadlineTick
  )
    failures.push('deadline_missed')
  const buyer = rebuilt.characters.find((entry) => entry.id === goal.buyerId)
  if (!buyer || buyer.role !== 'buyer') failures.push('buyer_missing')
  const spent = buyer?.spent ?? 0
  if (spent > goal.budget) failures.push('budget_exceeded')
  const unresolved = rebuilt.orders.filter(
    (entry) => entry.state === 'accepted' || entry.state === 'assigned',
  ).length
  if (unresolved > 0) failures.push('unresolved_commitments')
  return Result.ok({
    kind: failures.length === 0 ? 'passed' : 'failed',
    failures: [...new Set(failures)],
    metrics: {
      appliedActions: rebuilt.receipts.filter(
        (entry) => entry.outcome.kind === 'applied',
      ).length,
      rejectedActions: rebuilt.receipts.filter(
        (entry) => entry.outcome.kind === 'rejected',
      ).length,
      unresolvedCommitments: unresolved,
      spent,
      ...(order?.deliveredTick !== undefined
        ? { completionTick: order.deliveredTick }
        : {}),
    },
  })
}
