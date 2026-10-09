import { z } from 'zod'

const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/)
const amount = z.number().int().min(0).max(1_000_000_000)
const tick = z.number().int().min(0).max(1_000_000_000)

export const marketplaceConfigSchema = z
  .strictObject({
    environmentId: id,
    characters: z
      .array(
        z.strictObject({
          id,
          role: z.enum(['buyer', 'shopkeeper', 'courier']),
          balance: amount,
          spendingLimit: amount,
          allowedRecipients: z.array(id),
        }),
      )
      .min(3)
      .max(1000),
    inventory: z
      .array(
        z.strictObject({
          itemId: id,
          sellerId: id,
          quantity: z.number().int().min(0).max(1_000_000),
          unitPrice: amount,
        }),
      )
      .min(1)
      .max(1000),
    deliveryFee: amount,
  })
  .superRefine((config, ctx) => {
    const characters = new Map(config.characters.map((c) => [c.id, c]))
    for (const role of ['buyer', 'shopkeeper', 'courier'] as const) {
      if (!config.characters.some((character) => character.role === role)) {
        ctx.addIssue({ code: 'custom', message: `Missing ${role} role` })
      }
    }
    if (characters.size !== config.characters.length) {
      ctx.addIssue({ code: 'custom', message: 'Character IDs must be unique' })
    }
    const items = new Set(config.inventory.map((item) => item.itemId))
    if (items.size !== config.inventory.length) {
      ctx.addIssue({ code: 'custom', message: 'Item IDs must be unique' })
    }
    for (const item of config.inventory) {
      if (characters.get(item.sellerId)?.role !== 'shopkeeper') {
        ctx.addIssue({
          code: 'custom',
          message: 'Inventory must belong to a shopkeeper',
        })
      }
    }
    for (const character of config.characters) {
      if (
        character.allowedRecipients.some(
          (recipient) => !characters.has(recipient),
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Recipients must be known characters',
        })
      }
    }
  })

export const marketplaceActionSchema = z.strictObject({
  actionId: id,
  episodeId: id,
  environmentId: id,
  expectedRevision: z.number().int().nonnegative().safe(),
  command: z.discriminatedUnion('tool', [
    z.strictObject({
      tool: z.literal('create_quote'),
      orderId: id,
      buyerId: id,
      recipientId: id,
      itemId: id,
      quantity: z.number().int().min(1).max(10_000),
      deadlineTick: tick,
    }),
    ...(
      [
        'accept_order',
        'accept_delivery',
        'deliver_order',
        'cancel_order',
      ] as const
    ).map((tool) => z.strictObject({ tool: z.literal(tool), orderId: id })),
  ]),
})

export const marketplaceGoalSchema = z.strictObject({
  orderId: id,
  buyerId: id,
  sellerId: id,
  recipientId: id,
  itemId: id,
  quantity: z.number().int().min(1).max(10_000),
  budget: amount,
  deadlineTick: tick,
})

export type MarketplaceConfig = z.infer<typeof marketplaceConfigSchema>
export type MarketplaceAction = z.infer<typeof marketplaceActionSchema>
export type MarketplaceGoal = z.infer<typeof marketplaceGoalSchema>
export type Character = MarketplaceConfig['characters'][number] & {
  spent: number
}
export type OrderState =
  | 'quoted'
  | 'accepted'
  | 'assigned'
  | 'delivered'
  | 'cancelled'
export type Order = {
  id: string
  buyerId: string
  sellerId: string
  recipientId: string
  itemId: string
  quantity: number
  goodsPrice: number
  deliveryFee: number
  deadlineTick: number
  state: OrderState
  escrow: number
  courierId?: string
  deliveredTick?: number
}

export type RejectionReason =
  | 'unauthorised'
  | 'stale_state'
  | 'order_exists'
  | 'order_missing'
  | 'invalid_transition'
  | 'unavailable_stock'
  | 'insufficient_funds'
  | 'spending_limit'
  | 'recipient_not_allowed'
  | 'deadline_passed'

export type ActionOutcome =
  | { kind: 'applied'; orderId: string; state: OrderState }
  | { kind: 'rejected'; reason: RejectionReason }

export type Receipt = {
  action: MarketplaceAction
  characterId: string
  tick: number
  revisionBefore: number
  revisionAfter: number
  outcome: ActionOutcome
}

export type MarketplaceSnapshot = {
  contractVersion: 1
  environmentId: string
  episodeId: string
  revision: number
  tick: number
  deliveryFee: number
  characters: Character[]
  inventory: MarketplaceConfig['inventory']
  orders: Order[]
  receipts: Receipt[]
}

/** Actor identity comes from a trusted binding, never agent tool arguments. */
export type MarketplaceActor = { characterId: string }

export const episodeIdSchema = id
export const marketplaceTickSchema = tick
