import { and, eq, sql } from 'drizzle-orm'
import {
  resolveNotificationPreferences,
  type NotificationPreferenceUpdate,
  type NotificationPreferenceView,
} from '@garden/db/schema/notification-preferences'
import { schema, type Db } from '@/lib/server/db'

type MemberRef = { db: Db; workspaceId: string; userId: string }

const memberMatch = (args: MemberRef) =>
  and(
    eq(schema.member.organizationId, args.workspaceId),
    eq(schema.member.userId, args.userId),
  )

/** Resolved toggles for one workspace member, or null when not a member. */
export async function readMemberNotificationPreferences(
  args: MemberRef,
): Promise<NotificationPreferenceView | null> {
  const [row] = await args.db
    .select({ preferences: schema.member.notificationPreferences })
    .from(schema.member)
    .where(memberMatch(args))
    .limit(1)
  return row ? resolveNotificationPreferences(row.preferences) : null
}

/**
 * Set one category and channel in a single statement. The merge runs in
 * Postgres so concurrent toggles of different categories do not overwrite
 * each other. Returns null when the user is not a member.
 */
export async function updateMemberNotificationPreference(
  args: MemberRef & { update: NotificationPreferenceUpdate },
): Promise<NotificationPreferenceView | null> {
  const { category, channel, enabled } = args.update
  const column = schema.member.notificationPreferences
  const [row] = await args.db
    .update(schema.member)
    .set({
      notificationPreferences: sql`jsonb_set(${column}, array[${category}::text], coalesce(${column} -> ${category}::text, '{}'::jsonb) || jsonb_build_object(${channel}::text, ${enabled}::boolean))`,
    })
    .where(memberMatch(args))
    .returning({ preferences: column })
  return row ? resolveNotificationPreferences(row.preferences) : null
}
