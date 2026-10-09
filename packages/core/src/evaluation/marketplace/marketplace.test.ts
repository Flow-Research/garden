import { describe, expect, it } from 'vitest'
import {
  advanceMarketplaceClock,
  applyMarketplaceAction,
  createMarketplace,
  observeMarketplace,
  verifyMarketplace,
  type MarketplaceAction,
  type MarketplaceConfig,
  type MarketplaceSnapshot,
} from './index'

const config: MarketplaceConfig = {
  environmentId: 'market',
  deliveryFee: 100,
  characters: [
    {
      id: 'buyer',
      role: 'buyer',
      balance: 2000,
      spendingLimit: 2000,
      allowedRecipients: ['buyer'],
    },
    {
      id: 'seller',
      role: 'shopkeeper',
      balance: 0,
      spendingLimit: 0,
      allowedRecipients: [],
    },
    {
      id: 'courier',
      role: 'courier',
      balance: 0,
      spendingLimit: 0,
      allowedRecipients: [],
    },
  ],
  inventory: [
    { itemId: 'rice', sellerId: 'seller', quantity: 10, unitPrice: 200 },
  ],
}
const goal = {
  orderId: 'order',
  buyerId: 'buyer',
  sellerId: 'seller',
  recipientId: 'buyer',
  itemId: 'rice',
  quantity: 2,
  budget: 500,
  deadlineTick: 10,
}

/** Builds independent episodes from the same scenario fixture, not a shared mutable world. */
function world(input: MarketplaceConfig = config) {
  return createMarketplace(input, 'episode').unwrap()
}

/** Binds identity outside the action payload, as the future Garden gateway must do. */
function action(
  snapshot: MarketplaceSnapshot,
  actor: string,
  command: MarketplaceAction['command'],
  actionId = `action${snapshot.receipts.length}`,
) {
  return applyMarketplaceAction(
    snapshot,
    { characterId: actor },
    {
      actionId,
      environmentId: snapshot.environmentId,
      episodeId: snapshot.episodeId,
      expectedRevision: snapshot.revision,
      command,
    },
  ).unwrap()
}

/** Produces an accepted quote using the canonical budget and stock rules. */
function quote(snapshot: MarketplaceSnapshot = world(), orderId = 'order') {
  return action(snapshot, 'seller', {
    tool: 'create_quote',
    orderId,
    buyerId: 'buyer',
    recipientId: 'buyer',
    itemId: 'rice',
    quantity: 2,
    deadlineTick: 10,
  }).snapshot
}

/** Executes the scripted Stage A path without depending on an LLM or live backend. */
function delivered(initial: MarketplaceSnapshot = world()) {
  const quoted = quote(initial)
  const accepted = action(quoted, 'buyer', {
    tool: 'accept_order',
    orderId: 'order',
  }).snapshot
  const assigned = action(accepted, 'courier', {
    tool: 'accept_delivery',
    orderId: 'order',
  }).snapshot
  return action(assigned, 'courier', {
    tool: 'deliver_order',
    orderId: 'order',
  }).snapshot
}

describe('LagosLife mock marketplace', () => {
  it('completes a purchase and settles exact balances with authoritative evidence', () => {
    const initial = world()
    const final = delivered(initial)
    expect(final.characters.map((c) => c.balance)).toEqual([1500, 400, 100])
    expect(final.inventory[0]?.quantity).toBe(8)
    expect(final.orders[0]?.escrow).toBe(0)
    expect(final.receipts).toHaveLength(4)
    expect(verifyMarketplace(initial, final, goal).unwrap().kind).toBe('passed')
    expect(initial).toEqual(world())
  })

  it('replays an action once even after its revision becomes stale', () => {
    const initial = quote()
    const first = action(
      initial,
      'buyer',
      { tool: 'accept_order', orderId: 'order' },
      'accept',
    )
    const second = applyMarketplaceAction(
      first.snapshot,
      { characterId: 'buyer' },
      first.receipt.action,
    ).unwrap()
    expect(second.replayed).toBe(true)
    expect(second.receipt).toEqual(first.receipt)
    expect(second.snapshot).toEqual(first.snapshot)
  })

  it('replays a refused action without consuming revision or retrying side effects', () => {
    const first = action(quote(), 'seller', {
      tool: 'accept_order',
      orderId: 'order',
    })
    const replay = applyMarketplaceAction(
      first.snapshot,
      { characterId: 'seller' },
      first.receipt.action,
    ).unwrap()
    expect(replay.replayed).toBe(true)
    expect(replay.snapshot).toEqual(first.snapshot)
    expect(replay.receipt.revisionAfter).toBe(replay.receipt.revisionBefore)
  })

  it('rejects reused action IDs with changed arguments or identity', () => {
    const final = delivered()
    const receipt = final.receipts[0]!
    expect(
      applyMarketplaceAction(
        final,
        { characterId: 'seller' },
        { ...receipt.action, expectedRevision: 99 },
      ).isErr(),
    ).toBe(true)
    expect(
      applyMarketplaceAction(
        final,
        { characterId: 'buyer' },
        receipt.action,
      ).isErr(),
    ).toBe(true)
  })

  it('rejects stale state without changing balances or stock', () => {
    const initial = quote()
    const result = applyMarketplaceAction(
      initial,
      { characterId: 'buyer' },
      {
        actionId: 'stale',
        episodeId: 'episode',
        environmentId: 'market',
        expectedRevision: 0,
        command: { tool: 'accept_order', orderId: 'order' },
      },
    ).unwrap()
    expect(result.receipt.outcome).toEqual({
      kind: 'rejected',
      reason: 'stale_state',
    })
    expect(result.snapshot.characters).toEqual(initial.characters)
    expect(result.snapshot.inventory).toEqual(initial.inventory)
  })

  it('rejects actor spoofing, malformed amounts and cross-episode actions', () => {
    const w = quote()
    const request = {
      actionId: 'invalid',
      episodeId: 'episode',
      environmentId: 'market',
      expectedRevision: 1,
      command: { tool: 'accept_order', orderId: 'order' },
    }
    expect(
      applyMarketplaceAction(
        w,
        { characterId: 'buyer' },
        { ...request, characterId: 'seller' },
      ).isErr(),
    ).toBe(true)
    expect(
      applyMarketplaceAction(w, { characterId: 'unknown' }, request).isErr(),
    ).toBe(true)
    expect(
      applyMarketplaceAction(
        w,
        { characterId: 'buyer' },
        { ...request, episodeId: 'other' },
      ).isErr(),
    ).toBe(true)
    expect(
      applyMarketplaceAction(
        w,
        { characterId: 'seller' },
        {
          ...request,
          command: {
            tool: 'create_quote',
            orderId: 'newOrder',
            buyerId: 'buyer',
            recipientId: 'buyer',
            itemId: 'rice',
            quantity: -1,
            deadlineTick: 10,
          },
        },
      ).isErr(),
    ).toBe(true)
  })

  it.each([
    ['insufficient_funds', { balance: 499, spendingLimit: 2000 }],
    ['spending_limit', { balance: 2000, spendingLimit: 499 }],
    [
      'recipient_not_allowed',
      { balance: 2000, spendingLimit: 2000, allowedRecipients: [] },
    ],
  ])('enforces %s before reserving resources', (reason, override) => {
    const c = structuredClone(config)
    Object.assign(c.characters[0]!, override)
    const w = quote(world(c))
    const result = action(w, 'buyer', {
      tool: 'accept_order',
      orderId: 'order',
    })
    expect(result.receipt.outcome).toEqual({ kind: 'rejected', reason })
    expect(result.snapshot.characters).toEqual(w.characters)
    expect(result.snapshot.inventory).toEqual(w.inventory)
  })

  it('prevents overselling when two quoted orders compete for the last stock', () => {
    const c = structuredClone(config)
    c.inventory[0]!.quantity = 2
    const first = quote(world(c))
    const second = quote(first, 'other')
    const accepted = action(second, 'buyer', {
      tool: 'accept_order',
      orderId: 'order',
    }).snapshot
    const result = action(accepted, 'buyer', {
      tool: 'accept_order',
      orderId: 'other',
    })
    expect(result.receipt.outcome).toEqual({
      kind: 'rejected',
      reason: 'unavailable_stock',
    })
    expect(result.snapshot.characters[0]?.balance).toBe(1500)
    expect(result.snapshot.inventory[0]?.quantity).toBe(0)
  })

  it.each(['buyer', 'seller', 'courier'])(
    'refunds cancellation by %s exactly once',
    (actor) => {
      let w = action(quote(), 'buyer', {
        tool: 'accept_order',
        orderId: 'order',
      }).snapshot
      w = action(w, 'courier', {
        tool: 'accept_delivery',
        orderId: 'order',
      }).snapshot
      const cancelled = action(w, actor, {
        tool: 'cancel_order',
        orderId: 'order',
      }).snapshot
      const again = action(cancelled, actor, {
        tool: 'cancel_order',
        orderId: 'order',
      })
      expect(cancelled.characters.map((c) => c.balance)).toEqual([2000, 0, 0])
      expect(cancelled.inventory[0]?.quantity).toBe(10)
      expect(again.receipt.outcome).toEqual({
        kind: 'rejected',
        reason: 'invalid_transition',
      })
      expect(again.snapshot.characters).toEqual(cancelled.characters)
      expect(cancelled.characters[0]?.spent).toBe(500)
    },
  )

  it('rejects delivery by a character without the assigned commitment', () => {
    const w = action(quote(), 'buyer', {
      tool: 'accept_order',
      orderId: 'order',
    }).snapshot
    expect(
      action(w, 'seller', { tool: 'deliver_order', orderId: 'order' }).receipt
        .outcome,
    ).toEqual({ kind: 'rejected', reason: 'unauthorised' })
  })

  it('rejects new commitments after the deadline but records late fulfilment as failure', () => {
    const initial = world()
    const expired = advanceMarketplaceClock(quote(initial), 11).unwrap()
    expect(
      action(expired, 'buyer', { tool: 'accept_order', orderId: 'order' })
        .receipt.outcome,
    ).toEqual({ kind: 'rejected', reason: 'deadline_passed' })
    const accepted = action(quote(initial), 'buyer', {
      tool: 'accept_order',
      orderId: 'order',
    }).snapshot
    const assigned = action(accepted, 'courier', {
      tool: 'accept_delivery',
      orderId: 'order',
    }).snapshot
    const late = action(
      advanceMarketplaceClock(assigned, 11).unwrap(),
      'courier',
      { tool: 'deliver_order', orderId: 'order' },
    ).snapshot
    expect(verifyMarketplace(initial, late, goal).unwrap().failures).toContain(
      'deadline_missed',
    )
  })

  it('does not refund completed deliveries', () => {
    const w = delivered()
    expect(
      action(w, 'buyer', { tool: 'cancel_order', orderId: 'order' }).receipt
        .outcome,
    ).toEqual({ kind: 'rejected', reason: 'invalid_transition' })
  })

  it('exposes only the current character and permitted orders', () => {
    const w = quote()
    const view = observeMarketplace(w, { characterId: 'courier' }).unwrap()
    expect(view.orders).toEqual([])
    expect(view.inventory).toEqual([])
    expect(Object.keys(view)).not.toContain('receipts')
    expect(Object.keys(view)).not.toContain('characters')
    view.character.balance = 900
    expect(w.characters[2]?.balance).toBe(0)
  })

  it('rejects invalid configuration and backward clocks', () => {
    const c = structuredClone(config)
    c.characters[1]!.id = 'buyer'
    expect(createMarketplace(c, 'episode').isErr()).toBe(true)
    expect(createMarketplace(config, 'invalid id').isErr()).toBe(true)
    expect(
      advanceMarketplaceClock(
        advanceMarketplaceClock(world(), 5).unwrap(),
        4,
      ).isErr(),
    ).toBe(true)
  })

  it.each(['balance', 'receipt', 'delivery'])(
    'fails independent verification of tampered %s evidence',
    (kind) => {
      const initial = world()
      const final = delivered(initial)
      if (kind === 'balance') final.characters[0]!.balance += 1
      if (kind === 'receipt') final.receipts[0]!.characterId = 'buyer'
      if (kind === 'delivery') final.receipts.pop()
      expect(verifyMarketplace(initial, final, goal).unwrap().kind).toBe(
        'failed',
      )
    },
  )

  it('fails wrong recipient, budget and unresolved commitments against a separate goal', () => {
    const initial = world()
    const final = delivered(initial)
    expect(
      verifyMarketplace(initial, final, {
        ...goal,
        recipientId: 'seller',
      }).unwrap().failures,
    ).toContain('wrong_order')
    expect(
      verifyMarketplace(initial, final, { ...goal, budget: 499 }).unwrap()
        .failures,
    ).toContain('budget_exceeded')
    const pending = action(quote(final, 'other'), 'buyer', {
      tool: 'accept_order',
      orderId: 'other',
    }).snapshot
    expect(
      verifyMarketplace(initial, pending, goal).unwrap().failures,
    ).toContain('unresolved_commitments')
  })

  it('resets deterministically with an empty receipt ledger and different episode identity', () => {
    expect(world()).toEqual(world())
    const a = createMarketplace(config, 'first').unwrap()
    const b = createMarketplace(config, 'second').unwrap()
    expect(a.characters).toEqual(b.characters)
    expect(a.episodeId).not.toBe(b.episodeId)
    expect(b.receipts).toEqual([])
  })
})
