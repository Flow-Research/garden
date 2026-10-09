import { Result, TaggedError } from 'better-result'
import {
  episodeIdSchema,
  marketplaceActionSchema,
  marketplaceConfigSchema,
  marketplaceTickSchema,
  type ActionOutcome,
  type MarketplaceAction,
  type MarketplaceActor,
  type MarketplaceSnapshot,
  type Order,
  type RejectionReason,
} from './contracts'

export class MarketplaceInputError extends TaggedError(
  'MarketplaceInputError',
)<{
  message: string
}>() {}

export class MarketplaceScopeError extends TaggedError(
  'MarketplaceScopeError',
)<{
  message: string
}>() {}

export class MarketplaceReplayError extends TaggedError(
  'MarketplaceReplayError',
)<{
  message: string
}>() {}

export type MarketplaceError =
  | MarketplaceInputError
  | MarketplaceScopeError
  | MarketplaceReplayError

/** Exposes role-scoped observations, excluding other characters' balances, policies and action history. */
export function observeMarketplace(
  snapshot: MarketplaceSnapshot,
  actor: MarketplaceActor,
) {
  const character = snapshot.characters.find(
    (entry) => entry.id === actor.characterId,
  )
  if (!character)
    return Result.err(
      new MarketplaceScopeError({ message: 'Unknown authenticated character' }),
    )
  const orders = snapshot.orders.filter(
    (order) =>
      order.buyerId === character.id ||
      order.sellerId === character.id ||
      order.courierId === character.id ||
      (character.role === 'courier' && order.state === 'accepted'),
  )
  return Result.ok(
    structuredClone({
      environmentId: snapshot.environmentId,
      episodeId: snapshot.episodeId,
      revision: snapshot.revision,
      tick: snapshot.tick,
      character,
      inventory:
        character.role === 'courier'
          ? []
          : snapshot.inventory.filter(
              (item) =>
                character.role === 'buyer' || item.sellerId === character.id,
            ),
      orders,
    }),
  )
}

/** Creates isolated, resettable test worlds; no live game or Garden state is touched. */
export function createMarketplace(
  config: unknown,
  episodeId: unknown,
): Result<MarketplaceSnapshot, MarketplaceInputError> {
  const parsed = marketplaceConfigSchema.safeParse(config)
  if (!parsed.success)
    return Result.err(
      new MarketplaceInputError({ message: parsed.error.message }),
    )
  const episode = episodeIdSchema.safeParse(episodeId)
  if (!episode.success)
    return Result.err(
      new MarketplaceInputError({ message: episode.error.message }),
    )
  return Result.ok({
    contractVersion: 1 as const,
    environmentId: parsed.data.environmentId,
    episodeId: episode.data,
    revision: 0,
    tick: 0,
    deliveryFee: parsed.data.deliveryFee,
    characters: parsed.data.characters.map((character) => ({
      ...character,
      spent: 0,
    })),
    inventory: parsed.data.inventory,
    orders: [],
    receipts: [],
  })
}

/** Advances the scenario clock explicitly; agent payloads cannot choose execution time. */
export function advanceMarketplaceClock(
  snapshot: MarketplaceSnapshot,
  nextTick: unknown,
): Result<MarketplaceSnapshot, MarketplaceInputError> {
  const parsed = marketplaceTickSchema.safeParse(nextTick)
  if (!parsed.success || parsed.data < snapshot.tick) {
    return Result.err(
      new MarketplaceInputError({
        message: 'Clock must be a valid, nondecreasing tick',
      }),
    )
  }
  return Result.ok({ ...structuredClone(snapshot), tick: parsed.data })
}

/** Applies one transaction to a private copy; expected business refusals produce inspectable receipts. */
function execute(
  snapshot: MarketplaceSnapshot,
  action: MarketplaceAction,
  actor: MarketplaceActor,
): ActionOutcome {
  const command = action.command
  const character = snapshot.characters.find(
    (entry) => entry.id === actor.characterId,
  )!
  const reject = (reason: RejectionReason): ActionOutcome => ({
    kind: 'rejected',
    reason,
  })
  if (action.expectedRevision !== snapshot.revision)
    return reject('stale_state')
  if (command.tool === 'create_quote') {
    if (character.role !== 'shopkeeper') return reject('unauthorised')
    if (snapshot.orders.some((entry) => entry.id === command.orderId))
      return reject('order_exists')
    const item = snapshot.inventory.find(
      (entry) => entry.itemId === command.itemId,
    )
    const buyer = snapshot.characters.find(
      (entry) => entry.id === command.buyerId,
    )
    if (
      !item ||
      item.sellerId !== character.id ||
      !buyer ||
      buyer.role !== 'buyer'
    )
      return reject('unauthorised')
    if (!snapshot.characters.some((entry) => entry.id === command.recipientId))
      return reject('recipient_not_allowed')
    if (item.quantity < command.quantity) return reject('unavailable_stock')
    if (command.deadlineTick < snapshot.tick) return reject('deadline_passed')
    const order: Order = {
      id: command.orderId,
      buyerId: command.buyerId,
      sellerId: character.id,
      recipientId: command.recipientId,
      itemId: command.itemId,
      quantity: command.quantity,
      goodsPrice: item.unitPrice * command.quantity,
      deliveryFee: snapshot.deliveryFee,
      deadlineTick: command.deadlineTick,
      state: 'quoted',
      escrow: 0,
    }
    snapshot.orders.push(order)
    return { kind: 'applied', orderId: order.id, state: order.state }
  }
  const order = snapshot.orders.find((entry) => entry.id === command.orderId)
  if (!order) return reject('order_missing')
  const buyer = snapshot.characters.find((entry) => entry.id === order.buyerId)!
  const item = snapshot.inventory.find(
    (entry) => entry.itemId === order.itemId,
  )!
  const total = order.goodsPrice + order.deliveryFee
  switch (command.tool) {
    case 'accept_order': {
      if (character.id !== order.buyerId) return reject('unauthorised')
      if (order.state !== 'quoted') return reject('invalid_transition')
      if (snapshot.tick > order.deadlineTick) return reject('deadline_passed')
      if (!buyer.allowedRecipients.includes(order.recipientId))
        return reject('recipient_not_allowed')
      if (buyer.spent + total > buyer.spendingLimit)
        return reject('spending_limit')
      if (buyer.balance < total) return reject('insufficient_funds')
      if (item.quantity < order.quantity) return reject('unavailable_stock')
      buyer.balance -= total
      buyer.spent += total
      item.quantity -= order.quantity
      order.escrow = total
      order.state = 'accepted'
      break
    }
    case 'accept_delivery': {
      if (character.role !== 'courier') return reject('unauthorised')
      if (order.state !== 'accepted') return reject('invalid_transition')
      if (snapshot.tick > order.deadlineTick) return reject('deadline_passed')
      order.courierId = character.id
      order.state = 'assigned'
      break
    }
    case 'deliver_order': {
      if (character.id !== order.courierId) return reject('unauthorised')
      if (order.state !== 'assigned') return reject('invalid_transition')
      const seller = snapshot.characters.find(
        (entry) => entry.id === order.sellerId,
      )!
      seller.balance += order.goodsPrice
      character.balance += order.deliveryFee
      order.escrow = 0
      order.state = 'delivered'
      order.deliveredTick = snapshot.tick
      break
    }
    case 'cancel_order': {
      if (
        character.id !== order.buyerId &&
        character.id !== order.sellerId &&
        character.id !== order.courierId
      )
        return reject('unauthorised')
      if (order.state === 'delivered' || order.state === 'cancelled')
        return reject('invalid_transition')
      if (order.state !== 'quoted') {
        buyer.balance += order.escrow
        item.quantity += order.quantity
      }
      order.escrow = 0
      order.state = 'cancelled'
      break
    }
  }
  return { kind: 'applied', orderId: order.id, state: order.state }
}

/** Guards scope and replay identity before transactional mutation, including stale-revision retries. */
export function applyMarketplaceAction(
  snapshot: MarketplaceSnapshot,
  actor: MarketplaceActor,
  input: unknown,
): Result<
  {
    snapshot: MarketplaceSnapshot
    receipt: MarketplaceSnapshot['receipts'][number]
    replayed: boolean
  },
  MarketplaceError
> {
  const parsed = marketplaceActionSchema.safeParse(input)
  if (!parsed.success)
    return Result.err(
      new MarketplaceInputError({ message: parsed.error.message }),
    )
  const action = parsed.data
  if (
    action.environmentId !== snapshot.environmentId ||
    action.episodeId !== snapshot.episodeId ||
    !snapshot.characters.some((entry) => entry.id === actor.characterId)
  ) {
    return Result.err(
      new MarketplaceScopeError({
        message:
          'Action must target this episode and an authenticated character',
      }),
    )
  }
  const prior = snapshot.receipts.find(
    (entry) => entry.action.actionId === action.actionId,
  )
  if (prior) {
    if (
      prior.characterId !== actor.characterId ||
      JSON.stringify(prior.action) !== JSON.stringify(action)
    ) {
      return Result.err(
        new MarketplaceReplayError({
          message: 'Action ID was reused for a different request or character',
        }),
      )
    }
    return Result.ok({
      snapshot: structuredClone(snapshot),
      receipt: structuredClone(prior),
      replayed: true,
    })
  }
  const next = structuredClone(snapshot)
  const outcome = execute(next, action, actor)
  if (outcome.kind === 'applied') next.revision += 1
  const receipt = {
    action,
    characterId: actor.characterId,
    tick: snapshot.tick,
    revisionBefore: snapshot.revision,
    revisionAfter: next.revision,
    outcome,
  }
  next.receipts.push(receipt)
  return Result.ok({
    snapshot: next,
    receipt: structuredClone(receipt),
    replayed: false,
  })
}
