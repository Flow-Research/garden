import { and, asc, eq, sql } from 'drizzle-orm'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { Resend } from 'resend'
import type { GardenDatabase } from '@garden/db'
import * as schema from '@garden/db/schema'
import type { NotificationEmail } from '@garden/db/schema/notification-email'
import { canReceiveIssueNotification } from '@garden/db/inbox'
import { buildIssueDeepLink } from '@garden/core/issues/deep-link'
import { createLogger } from '@garden/observability/console'
import type { AppEnv } from '@/lib/server/env'

type Payload = Extract<NotificationEmail, { kind: 'sending' }>['payload']
type EmailEnv = Pick<AppEnv, 'RESEND_API_KEY' | 'BETTER_AUTH_URL'>
export class NotificationEmailError extends TaggedError(
  'NotificationEmailError',
)<{
  message: string
  retryable: boolean
  cause?: unknown
}>() {}

export type NotificationEmailSender = (
  payload: Payload,
  idempotencyKey: string,
) => Promise<ResultValue<{ id: string }, NotificationEmailError>>

type DispatchReport =
  | { kind: 'unconfigured' }
  | {
      kind: 'processed'
      sent: number
      skipped: number
      failed: number
      retryPending: number
    }

// Resend retains keys for 24h. Beyond this bound an ambiguous send could duplicate.
const IDEMPOTENCY_LIFETIME_MS = 24 * 60 * 60 * 1000
const FROM = 'Garden <hello@garden.flowresearch.tech>'
const logger = createLogger('notification-email')

/** Escape user-controlled titles and excerpts for Worker-safe email HTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Create both email formats from the inbox record. Previously assignments had
 * a separate sender; now every item uses its own title and workspace-scoped CTA.
 */
export function buildNotificationEmail(args: {
  item: typeof schema.inboxItem.$inferSelect
  email: string
  workspaceName: string
  baseURL: string
}): Payload {
  const url = args.item.issueId
    ? buildIssueDeepLink(args.baseURL, args.item.workspaceId, args.item.issueId)
    : new URL(
        `/inbox?workspace_id=${encodeURIComponent(args.item.workspaceId)}`,
        args.baseURL,
      ).href
  const body = args.item.body ?? ''
  return {
    to: args.email,
    subject: `${args.item.title} · ${args.workspaceName}`,
    text: [
      args.item.title,
      args.workspaceName,
      '',
      body,
      '',
      `View in Garden: ${url}`,
    ].join('\n'),
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f2f0eb;color:#263029;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fbfaf6;border:1px solid #d9d3ca;border-radius:16px"><p>Garden · ${escapeHtml(args.workspaceName)}</p><h1 style="font-family:Georgia,serif;font-weight:400">${escapeHtml(args.item.title)}</h1><p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(body)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#263029;color:#f2f0eb;text-decoration:none">View in Garden</a></p><p style="font-size:12px;word-break:break-all">${escapeHtml(url)}</p></main></body></html>`,
  }
}

/**
 * Resend returns API errors as values but network failures reject. Normalize
 * both at this boundary; callers retain pending state and retry the same key.
 * References: installed resend SDK and Resend idempotency-key documentation.
 */
function resendSender(apiKey: string): NotificationEmailSender {
  const resend = new Resend(apiKey)
  return (payload, idempotencyKey) =>
    Result.gen(async function* () {
      const response = yield* Result.await(
        Result.tryPromise({
          try: () =>
            resend.emails.send(
              {
                from: FROM,
                ...payload,
                tags: [{ name: 'kind', value: 'inbox_notification' }],
              },
              { idempotencyKey },
            ),
          catch: (cause) =>
            new NotificationEmailError({
              message: 'Resend request failed',
              retryable: true,
              cause,
            }),
        }),
      )
      if (response.error)
        return Result.err(
          new NotificationEmailError({
            message: `Resend rejected notification: ${response.error.name}`,
            retryable:
              !response.error.statusCode ||
              response.error.statusCode >= 500 ||
              response.error.statusCode === 429 ||
              response.error.statusCode === 409,
          }),
        )
      return Result.ok(response.data)
    })
}

/**
 * Drain inbox delivery records without depending on a browser read. The first
 * attempt commits an immutable snapshot before contacting Resend; concurrent
 * cron invocations share the key/payload and cannot create two provider emails.
 * Failed sends remain retryable only inside Resend's documented 24h window.
 * No locks or database transactions are held over the external network call.
 */
export async function dispatchNotificationEmails(args: {
  db: GardenDatabase
  env: EmailEnv
  send?: NotificationEmailSender
  now?: Date
}): Promise<ResultValue<DispatchReport, NotificationEmailError>> {
  if (!args.env.RESEND_API_KEY?.trim() || !args.env.BETTER_AUTH_URL?.trim()) {
    return Result.ok({ kind: 'unconfigured' as const })
  }
  const baseURL = args.env.BETTER_AUTH_URL
  const send = args.send ?? resendSender(args.env.RESEND_API_KEY)
  const now = args.now ?? new Date()
  return Result.tryPromise({
    try: async () => {
      const report = {
        kind: 'processed' as const,
        sent: 0,
        skipped: 0,
        failed: 0,
        retryPending: 0,
      }
      const rows = await args.db
        .select()
        .from(schema.inboxItem)
        .where(
          sql`${schema.inboxItem.emailDelivery}->>'kind' in ('pending', 'sending')`,
        )
        .orderBy(asc(schema.inboxItem.createdAt))
        .limit(50)
      for (const item of rows) {
        const [recipient] = await args.db
          .select({
            email: schema.user.email,
            workspaceName: schema.organization.name,
          })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .innerJoin(
            schema.organization,
            eq(schema.organization.id, schema.member.organizationId),
          )
          .where(
            and(
              eq(schema.member.organizationId, item.workspaceId),
              eq(schema.member.userId, item.recipientId),
            ),
          )
          .limit(1)
        const [issue] = item.issueId
          ? await args.db
              .select()
              .from(schema.issue)
              .where(
                and(
                  eq(schema.issue.id, item.issueId),
                  eq(schema.issue.workspaceId, item.workspaceId),
                ),
              )
              .limit(1)
          : []
        const allowed =
          recipient &&
          (item.actorType !== 'member' || item.actorId !== item.recipientId) &&
          (!item.issueId ||
            (issue &&
              (await canReceiveIssueNotification(
                args.db,
                issue,
                item.recipientId,
              ))))
        if (!allowed) {
          await args.db
            .update(schema.inboxItem)
            .set({
              emailDelivery: { kind: 'skipped', reason: 'recipient_access' },
            })
            .where(
              and(
                eq(schema.inboxItem.id, item.id),
                sql`${schema.inboxItem.emailDelivery}->>'kind' in ('pending', 'sending')`,
              ),
            )
          report.skipped++
          continue
        }
        let delivery = item.emailDelivery
        if (delivery.kind === 'pending') {
          const snapshot = {
            kind: 'sending',
            startedAt: now.toISOString(),
            payload: buildNotificationEmail({
              item,
              email: recipient.email,
              workspaceName: recipient.workspaceName,
              baseURL,
            }),
          } satisfies NotificationEmail
          const [claimed] = await args.db
            .update(schema.inboxItem)
            .set({ emailDelivery: snapshot })
            .where(
              and(
                eq(schema.inboxItem.id, item.id),
                sql`${schema.inboxItem.emailDelivery}->>'kind' = 'pending'`,
              ),
            )
            .returning({ id: schema.inboxItem.id })
          if (!claimed) continue
          delivery = snapshot
        }
        if (delivery.kind !== 'sending') continue
        if (delivery.payload.to !== recipient.email) {
          await args.db
            .update(schema.inboxItem)
            .set({
              emailDelivery: {
                kind: 'skipped',
                reason: 'recipient_email_changed',
              },
            })
            .where(
              and(
                eq(schema.inboxItem.id, item.id),
                sql`${schema.inboxItem.emailDelivery}->>'kind' = 'sending'`,
              ),
            )
          report.skipped++
          continue
        }
        if (
          now.getTime() - Date.parse(delivery.startedAt) >=
          IDEMPOTENCY_LIFETIME_MS
        ) {
          await args.db
            .update(schema.inboxItem)
            .set({
              emailDelivery: {
                kind: 'failed',
                reason: 'idempotency_window_expired',
              },
            })
            .where(
              and(
                eq(schema.inboxItem.id, item.id),
                sql`${schema.inboxItem.emailDelivery}->>'kind' = 'sending'`,
              ),
            )
          logger.warn('idempotency_window_expired', { inboxItemId: item.id })
          report.failed++
          continue
        }
        const outcome = await send(delivery.payload, `inbox/${item.id}`)
        const nextAction = await outcome.match({
          ok: async ({ id }) => {
            await args.db
              .update(schema.inboxItem)
              .set({ emailDelivery: { kind: 'sent', providerId: id } })
              .where(
                and(
                  eq(schema.inboxItem.id, item.id),
                  sql`${schema.inboxItem.emailDelivery}->>'kind' = 'sending'`,
                ),
              )
            report.sent++
            return 'continue'
          },
          err: async (error) => {
            logger.warn('send_failed', {
              inboxItemId: item.id,
              retryable: error.retryable,
              message: error.message,
            })
            if (error.retryable) {
              report.retryPending++
              return 'retry_later'
            }
            await args.db
              .update(schema.inboxItem)
              .set({ emailDelivery: { kind: 'failed', reason: error.message } })
              .where(
                and(
                  eq(schema.inboxItem.id, item.id),
                  sql`${schema.inboxItem.emailDelivery}->>'kind' = 'sending'`,
                ),
              )
            report.failed++
            return 'continue'
          },
        })
        // A rate limit or outage applies to this sender too; retry next tick.
        if (nextAction === 'retry_later') break
      }
      return report
    },
    catch: (cause) =>
      new NotificationEmailError({
        message: 'Notification email dispatch failed',
        retryable: true,
        cause,
      }),
  })
}
