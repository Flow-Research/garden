import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { GardenDatabase } from './client.js'
import * as schema from './schema/index.js'
import {
  issueSubscriberReasonValues,
  issueSubscriberUserTypeValues,
} from './schema/issue-values.js'

/**
 * Issue participant ("subscriber") helpers.
 *
 * Why this module exists: the web app already has a full participants UI
 * (facepile + add/remove popover in issue-detail.tsx) and tagging an agent in a
 * comment already triggers a run, but none of that was durable — the
 * subscribe/unsubscribe routes were no-ops and the subscribers endpoint
 * computed creator+assignee on the fly. This module backs that surface with the
 * real `issue_subscriber` table so a tagged agent (or any member) durably
 * *joins* the issue. Mirrors the structure of ./inbox.ts.
 *
 * Population is idempotent and first-write-wins: addIssueSubscribers uses
 * onConflictDoNothing on (issueId, userType, userId) so a stronger 'creator' or
 * 'assignee' reason is never overwritten by a later 'mentioned'/'commenter'.
 */

type GardenDb = GardenDatabase

export type SubscriberUserType = (typeof issueSubscriberUserTypeValues)[number]
export type SubscriberReason = (typeof issueSubscriberReasonValues)[number]

export interface IssueSubscriberRecord {
  issueId: string
  workspaceId: string
  userType: SubscriberUserType
  userId: string
  reason: SubscriberReason
  createdAt: Date
}

export interface SubscriberEntry {
  userType: SubscriberUserType
  userId: string
  reason: SubscriberReason
}

/**
 * Map a stored issue assignee type ('user' | 'agent') onto a subscriber user
 * type ('member' | 'agent'). Issues store assignees as 'user', participants use
 * 'member' to match inbox/actor conventions across the app.
 */
export function assigneeToSubscriberType(
  assigneeType: string | null | undefined,
): SubscriberUserType | null {
  if (assigneeType === 'agent') return 'agent'
  if (assigneeType === 'user' || assigneeType === 'member') return 'member'
  return null
}

/**
 * Durably add participants to an issue. Best-effort and idempotent — duplicate
 * (issue, participant) pairs are ignored, preserving the earliest reason.
 */
export async function addIssueSubscribers(
  db: GardenDb,
  args: {
    workspaceId: string
    issueId: string
    entries: SubscriberEntry[]
  },
): Promise<void> {
  if (args.entries.length === 0) return

  // Dedupe within the batch so a participant mentioned twice (or who is both
  // commenter and mentioned) yields a single row with a stable reason.
  const seen = new Map<string, SubscriberEntry>()
  for (const entry of args.entries) {
    const key = `${entry.userType}:${entry.userId}`
    if (!seen.has(key)) seen.set(key, entry)
  }

  await db
    .insert(schema.issueSubscriber)
    .values(
      [...seen.values()].map((entry) => ({
        id: randomUUID(),
        workspaceId: args.workspaceId,
        issueId: args.issueId,
        userType: entry.userType,
        userId: entry.userId,
        reason: entry.reason,
      })),
    )
    .onConflictDoNothing({
      target: [
        schema.issueSubscriber.issueId,
        schema.issueSubscriber.userType,
        schema.issueSubscriber.userId,
      ],
    })
}

/**
 * List an issue's participants.
 *
 * The table is authoritative: creator and assignee are seeded at creation /
 * assignment time (createIssue + the issue PUT route), and the 0037 migration
 * backfills both for issues that predate this table. We deliberately do NOT
 * re-derive creator/assignee here — doing so would resurrect a participant who
 * explicitly unsubscribed (their row is deleted, so a derived fallback would
 * silently re-add them on the next read).
 */
export async function listIssueSubscribers(
  db: GardenDb,
  args: { issueId: string },
): Promise<IssueSubscriberRecord[]> {
  const rows = await db
    .select({
      issueId: schema.issueSubscriber.issueId,
      workspaceId: schema.issueSubscriber.workspaceId,
      userType: schema.issueSubscriber.userType,
      userId: schema.issueSubscriber.userId,
      reason: schema.issueSubscriber.reason,
      createdAt: schema.issueSubscriber.createdAt,
    })
    .from(schema.issueSubscriber)
    .where(eq(schema.issueSubscriber.issueId, args.issueId))

  return rows as IssueSubscriberRecord[]
}

/**
 * Toggle a manual subscription. Subscribing inserts a 'manual' row (idempotent,
 * never downgrades an existing reason); unsubscribing removes the participant
 * entirely. Returns the resulting persisted record list-relevant fields.
 */
export async function setIssueSubscription(
  db: GardenDb,
  args: {
    workspaceId: string
    issueId: string
    userType: SubscriberUserType
    userId: string
    subscribed: boolean
  },
): Promise<void> {
  if (args.subscribed) {
    await addIssueSubscribers(db, {
      workspaceId: args.workspaceId,
      issueId: args.issueId,
      entries: [{ userType: args.userType, userId: args.userId, reason: 'manual' }],
    })
    return
  }

  await db
    .delete(schema.issueSubscriber)
    .where(
      and(
        eq(schema.issueSubscriber.issueId, args.issueId),
        eq(schema.issueSubscriber.userType, args.userType),
        eq(schema.issueSubscriber.userId, args.userId),
      ),
    )
}
