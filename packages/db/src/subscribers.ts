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
 * List an issue's participants. Reads the persisted table and merges in the
 * derived creator + assignee so issues created before this feature (or before
 * their first comment) still surface their implicit participants. Table rows
 * win on conflict because they carry the authoritative reason.
 */
export async function listIssueSubscribers(
  db: GardenDb,
  args: { issueId: string },
): Promise<IssueSubscriberRecord[]> {
  const [issue] = await db
    .select({
      id: schema.issue.id,
      workspaceId: schema.issue.workspaceId,
      createdBy: schema.issue.createdBy,
      assigneeType: schema.issue.assigneeType,
      assigneeId: schema.issue.assigneeId,
      createdAt: schema.issue.createdAt,
      updatedAt: schema.issue.updatedAt,
    })
    .from(schema.issue)
    .where(eq(schema.issue.id, args.issueId))
    .limit(1)
  if (!issue) return []

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

  const byKey = new Map<string, IssueSubscriberRecord>()
  const put = (record: IssueSubscriberRecord, override: boolean) => {
    const key = `${record.userType}:${record.userId}`
    if (override || !byKey.has(key)) byKey.set(key, record)
  }

  // Derived participants first (lowest precedence), then persisted rows override.
  put(
    {
      issueId: issue.id,
      workspaceId: issue.workspaceId,
      userType: 'member',
      userId: issue.createdBy,
      reason: 'creator',
      createdAt: issue.createdAt ?? new Date(),
    },
    false,
  )
  const assigneeType = assigneeToSubscriberType(issue.assigneeType)
  if (assigneeType && issue.assigneeId) {
    put(
      {
        issueId: issue.id,
        workspaceId: issue.workspaceId,
        userType: assigneeType,
        userId: issue.assigneeId,
        reason: 'assignee',
        createdAt: issue.updatedAt ?? issue.createdAt ?? new Date(),
      },
      false,
    )
  }
  for (const row of rows) {
    put(row as IssueSubscriberRecord, true)
  }

  return [...byKey.values()]
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
