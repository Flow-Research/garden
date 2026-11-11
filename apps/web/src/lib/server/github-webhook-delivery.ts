import { and, eq, sql } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { schema, type Db } from '@/lib/server/db'

export type GitHubWebhookTx = Parameters<Parameters<Db['transaction']>[0]>[0]

export class GitHubWebhookDeliveryError extends TaggedError(
  'GitHubWebhookDeliveryError',
)<{
  message: string
  cause: unknown
}>() {}

/** Identity of one GitHub delivery, taken from its headers and payload. */
export type GitHubWebhookDelivery = {
  deliveryId: string
  event: string
  action: string
}

/**
 * Where a delivery sits in time: GitHub's `updated_at` (ms) for the issue or
 * comment, compared only against other deliveries in the same scope.
 */
export type GitHubWebhookOrder = {
  scope: string
  marker: number
}

export type GitHubWebhookDeliveryOutcome<T> =
  | { kind: 'unbound' }
  | { kind: 'duplicate' }
  | { kind: 'stale' }
  | { kind: 'processed'; result: T }

/**
 * Records a GitHub delivery in the ledger and applies it, all in one
 * transaction.
 *
 * Why one transaction: the earlier version claimed the delivery id first and
 * applied afterwards, so a failed apply left a claimed id behind and a
 * redelivery of it was then dropped as a duplicate. Now a failed apply rolls
 * the ledger row back with it, and a redelivery can succeed.
 *
 * Ordering: the binding row is locked `FOR UPDATE` first, so deliveries for one
 * linked issue run one at a time and the "newest applied marker" read cannot
 * race another delivery. A delivery is stale when an applied delivery in its
 * scope has a later marker, or when its comment scope already applied an
 * `issue_comment.deleted` (a late `edited` must not bring a deleted comment
 * back). The tombstone is limited to comment events: before, any `deleted`
 * action counted, so one `issues.deleted` made the issue scope stale forever.
 * Callers pass only actions the apply step supports, so an unsupported action
 * never lands in the ledger as `applied` and never moves the marker. Equal
 * markers apply, because GitHub timestamps have one-second resolution and two
 * real edits can share a second. Stale deliveries are
 * still recorded so a redelivery of them is a duplicate.
 *
 * GitHub delivery headers:
 * https://docs.github.com/en/webhooks/webhook-events-and-payloads#delivery-headers
 */
export async function processGitHubWebhookDelivery<T>(args: {
  db: Db
  bindingId: string
  delivery: GitHubWebhookDelivery
  order: GitHubWebhookOrder
  apply: (tx: GitHubWebhookTx) => Promise<T>
}): Promise<
  Result<GitHubWebhookDeliveryOutcome<T>, GitHubWebhookDeliveryError>
> {
  return Result.tryPromise({
    try: () =>
      args.db.transaction(
        async (tx): Promise<GitHubWebhookDeliveryOutcome<T>> => {
          const [binding] = await tx
            .select({ id: schema.issueSourceBinding.id })
            .from(schema.issueSourceBinding)
            .where(eq(schema.issueSourceBinding.id, args.bindingId))
            .for('update')
          if (!binding) return { kind: 'unbound' }

          const [prior] = await tx
            .select({
              newestMarker: sql<
                number | null
              >`max(${schema.githubWebhookDelivery.orderMarker})`.mapWith(
                (value: string | null) =>
                  value === null ? null : Number(value),
              ),
              commentDeleted: sql<boolean>`coalesce(bool_or(${schema.githubWebhookDelivery.event} = 'issue_comment' and ${schema.githubWebhookDelivery.action} = 'deleted'), false)`,
            })
            .from(schema.githubWebhookDelivery)
            .where(
              and(
                eq(schema.githubWebhookDelivery.orderScope, args.order.scope),
                eq(schema.githubWebhookDelivery.status, 'applied'),
              ),
            )
          const stale =
            prior !== undefined &&
            (prior.commentDeleted ||
              (prior.newestMarker !== null &&
                args.order.marker < prior.newestMarker))

          const inserted = await tx
            .insert(schema.githubWebhookDelivery)
            .values({
              deliveryId: args.delivery.deliveryId,
              bindingId: args.bindingId,
              event: args.delivery.event,
              action: args.delivery.action,
              orderScope: args.order.scope,
              orderMarker: args.order.marker,
              status: stale ? 'stale' : 'applied',
            })
            .onConflictDoNothing({
              target: [
                schema.githubWebhookDelivery.bindingId,
                schema.githubWebhookDelivery.deliveryId,
              ],
            })
            .returning({ id: schema.githubWebhookDelivery.id })
          if (inserted.length === 0) return { kind: 'duplicate' }
          if (stale) return { kind: 'stale' }

          return { kind: 'processed', result: await args.apply(tx) }
        },
      ),
    catch: (cause) =>
      new GitHubWebhookDeliveryError({
        message: 'Failed to process GitHub webhook delivery',
        cause,
      }),
  })
}

/**
 * Records the GitHub `updated_at` a sync created a linked issue from, as an
 * applied delivery in the binding's issue scope.
 *
 * Why: the import wrote no marker, so a webhook older than the snapshot the
 * import wrote still applied and rolled the issue back, for example an
 * `edited` delivered late after the import read the newer title. With this
 * row, `processGitHubWebhookDelivery` treats any delivery older than the
 * snapshot as stale, the same way it orders two webhooks.
 */
export async function recordGitHubIssueSnapshotMarker(
  tx: GitHubWebhookTx,
  args: { bindingId: string; marker: number },
) {
  await tx.insert(schema.githubWebhookDelivery).values({
    deliveryId: `garden-sync:${args.bindingId}`,
    bindingId: args.bindingId,
    event: 'garden_sync',
    action: 'created',
    orderScope: githubWebhookIssueOrderScope(args.bindingId),
    orderMarker: args.marker,
    status: 'applied',
  })
}

/** Order scope for a linked issue's title, body, and state. */
export function githubWebhookIssueOrderScope(bindingId: string) {
  return `binding:${bindingId}:issue`
}

/**
 * Order scope for one pull request's effect on a linked issue, independent
 * of issue edits, so a PR's `updated_at` never makes an issue edit stale.
 */
export function githubWebhookPullRequestOrderScope(
  bindingId: string,
  pullRequestNumber: number,
) {
  return `binding:${bindingId}:pull_request:${pullRequestNumber}`
}

/** Order scope for one GitHub comment, independent of issue edits. */
export function githubWebhookCommentOrderScope(
  bindingId: string,
  commentId: string,
) {
  return `binding:${bindingId}:comment:${commentId}`
}
