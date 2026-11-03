import { and, desc, eq, sql } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { schema, type Db } from '@/lib/server/db'

export class GitHubWebhookDeliveryError extends TaggedError(
  'GitHubWebhookDeliveryError',
)<{
  code: 'missing_delivery_id' | 'db_error'
  message: string
  cause?: unknown
}>() {}

export type GitHubWebhookDeliveryClaim =
  | { kind: 'proceed' }
  | { kind: 'duplicate' }
  | { kind: 'out_of_order' }

/**
 * Claims an inbound GitHub delivery before apply (#161 review).
 *
 * Why: HMAC proves authenticity but not uniqueness or order. GitHub retries
 * reuse `X-GitHub-Delivery`; out-of-order hooks can reapply stale title/status.
 * Before: every verified POST ran apply. After: unique delivery_id short-
 * circuits retries; order_scope max(marker) rejects older events. Docs:
 * https://docs.github.com/en/webhooks/webhook-events-and-payloads#delivery-headers
 */
export async function claimGitHubWebhookDelivery(args: {
  db: Db
  deliveryId: string | null
  event: string
  action: string | null
  installationId: string | null
  orderScope: string
  orderMarker: number
  bindingId: string | null
  workspaceId: string | null
}): Promise<Result<GitHubWebhookDeliveryClaim, GitHubWebhookDeliveryError>> {
  const deliveryId = args.deliveryId?.trim() || null
  if (!deliveryId) {
    return Result.err(
      new GitHubWebhookDeliveryError({
        code: 'missing_delivery_id',
        message: 'Missing X-GitHub-Delivery header',
      }),
    )
  }

  const claimResult = await Result.tryPromise({
    try: async () => {
      const inserted = await args.db
        .insert(schema.githubWebhookDelivery)
        .values({
          deliveryId,
          event: args.event,
          action: args.action,
          installationId: args.installationId,
          orderScope: args.orderScope,
          orderMarker: args.orderMarker,
          status: 'applied',
          bindingId: args.bindingId,
          workspaceId: args.workspaceId,
        })
        .onConflictDoNothing({
          target: [schema.githubWebhookDelivery.deliveryId],
        })
        .returning({ id: schema.githubWebhookDelivery.id })

      if (inserted.length === 0) {
        return { kind: 'duplicate' as const }
      }

      const [latest] = await args.db
        .select({
          orderMarker: schema.githubWebhookDelivery.orderMarker,
          deliveryId: schema.githubWebhookDelivery.deliveryId,
        })
        .from(schema.githubWebhookDelivery)
        .where(
          and(
            eq(schema.githubWebhookDelivery.orderScope, args.orderScope),
            eq(schema.githubWebhookDelivery.status, 'applied'),
            sql`${schema.githubWebhookDelivery.deliveryId} <> ${deliveryId}`,
          ),
        )
        .orderBy(desc(schema.githubWebhookDelivery.orderMarker))
        .limit(1)

      if (latest && args.orderMarker < latest.orderMarker) {
        await args.db
          .update(schema.githubWebhookDelivery)
          .set({ status: 'out_of_order' })
          .where(eq(schema.githubWebhookDelivery.deliveryId, deliveryId))
        return { kind: 'out_of_order' as const }
      }

      return { kind: 'proceed' as const }
    },
    catch: (cause) =>
      new GitHubWebhookDeliveryError({
        code: 'db_error',
        message: 'Failed to claim GitHub webhook delivery',
        cause,
      }),
  })

  return claimResult
}

/** Issue-level order stream for a binding. */
export function githubWebhookIssueOrderScope(bindingId: string) {
  return `binding:${bindingId}:issue`
}

/** Comment-level order stream (independent of issue title/status edits). */
export function githubWebhookCommentOrderScope(
  bindingId: string,
  commentId: string,
) {
  return `binding:${bindingId}:comment:${commentId}`
}
