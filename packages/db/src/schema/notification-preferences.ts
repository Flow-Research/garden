import { z } from 'zod'

/** Member-facing notification categories, in Settings display order. */
export const notificationCategoryValues = [
  'mentions',
  'assignments',
  'approvals',
  'input_requests',
] as const

/**
 * Delivery channels a member can switch per category. Add a channel here
 * (for example `discord`); stored rows stay valid because absent keys read
 * as the default.
 */
export const notificationChannelValues = ['email'] as const

export type NotificationCategory = (typeof notificationCategoryValues)[number]
export type NotificationChannel = (typeof notificationChannelValues)[number]

const categorySchema = z.enum(notificationCategoryValues)
const channelSchema = z.enum(notificationChannelValues)

/**
 * Sparse opt-outs stored on `member.notification_preferences`. A missing
 * category or channel means enabled, so `{}` is the default for every member.
 */
export const notificationPreferencesSchema = z.partialRecord(
  categorySchema,
  z.partialRecord(channelSchema, z.boolean()),
)

export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>

/** One toggle change from Settings. The server derives the member from the session. */
export const notificationPreferenceUpdateSchema = z.strictObject({
  category: categorySchema,
  channel: channelSchema,
  enabled: z.boolean(),
})

export type NotificationPreferenceUpdate = z.infer<
  typeof notificationPreferenceUpdateSchema
>

/** Fully resolved toggles that the API returns, in display order. */
export type NotificationPreferenceView = Array<{
  category: NotificationCategory
  channels: Record<NotificationChannel, boolean>
}>

// Inbox types not listed here have no category. Preferences do not govern
// them, so they keep their channel delivery.
const categoryByInboxType: Record<string, NotificationCategory | undefined> = {
  mentioned: 'mentions',
  issue_assigned: 'assignments',
  assignee_changed: 'assignments',
  unassigned: 'assignments',
  review_requested: 'approvals',
  wp_review: 'approvals',
  brain_proposal: 'approvals',
  waiting_for_input: 'input_requests',
  connector_needed: 'input_requests',
}

/** Category that governs an inbox item type, or null when no toggle applies. */
export function notificationCategoryForInboxType(
  type: string,
): NotificationCategory | null {
  return categoryByInboxType[type] ?? null
}

/** Whether a member receives one inbox item type on one channel. */
export function isNotificationDeliveryEnabled(
  preferences: NotificationPreferences,
  inboxType: string,
  channel: NotificationChannel,
): boolean {
  const category = notificationCategoryForInboxType(inboxType)
  return category === null || preferences[category]?.[channel] !== false
}

/** Expand sparse stored opt-outs into every category and channel. */
export function resolveNotificationPreferences(
  preferences: NotificationPreferences,
): NotificationPreferenceView {
  return notificationCategoryValues.map((category) => ({
    category,
    channels: Object.fromEntries(
      notificationChannelValues.map((channel) => [
        channel,
        preferences[category]?.[channel] !== false,
      ]),
    ) as Record<NotificationChannel, boolean>,
  }))
}
