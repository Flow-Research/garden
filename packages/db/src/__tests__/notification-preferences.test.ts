import { describe, expect, it } from 'vitest'
import {
  isNotificationDeliveryEnabled,
  notificationCategoryForInboxType,
  notificationPreferencesSchema,
  notificationPreferenceUpdateSchema,
  resolveNotificationPreferences,
} from '../schema/notification-preferences.js'

describe('notification preferences', () => {
  it('enables email for every category when nothing is stored', () => {
    expect(resolveNotificationPreferences({})).toEqual([
      { category: 'mentions', channels: { email: true } },
      { category: 'assignments', channels: { email: true } },
      { category: 'approvals', channels: { email: true } },
      { category: 'input_requests', channels: { email: true } },
    ])
  })

  it('maps each requested inbox type to one category', () => {
    expect(
      Object.fromEntries(
        [
          'mentioned',
          'issue_assigned',
          'review_requested',
          'wp_review',
          'waiting_for_input',
          'connector_needed',
        ].map((type) => [type, notificationCategoryForInboxType(type)]),
      ),
    ).toEqual({
      mentioned: 'mentions',
      issue_assigned: 'assignments',
      review_requested: 'approvals',
      wp_review: 'approvals',
      waiting_for_input: 'input_requests',
      connector_needed: 'input_requests',
    })
  })

  it('turns off only the disabled category', () => {
    const preferences = { mentions: { email: false } }
    expect(
      isNotificationDeliveryEnabled(preferences, 'mentioned', 'email'),
    ).toBe(false)
    expect(
      isNotificationDeliveryEnabled(preferences, 'issue_assigned', 'email'),
    ).toBe(true)
  })

  it('keeps delivering inbox types that no category governs', () => {
    const allOff = {
      mentions: { email: false },
      assignments: { email: false },
      approvals: { email: false },
      input_requests: { email: false },
    }
    expect(notificationCategoryForInboxType('new_comment')).toBeNull()
    expect(isNotificationDeliveryEnabled(allOff, 'new_comment', 'email')).toBe(
      true,
    )
    expect(isNotificationDeliveryEnabled(allOff, 'future_type', 'email')).toBe(
      true,
    )
  })

  it('rejects unknown categories, channels, and extra fields', () => {
    const valid = { category: 'approvals', channel: 'email', enabled: false }
    expect(notificationPreferenceUpdateSchema.safeParse(valid).success).toBe(
      true,
    )
    for (const invalid of [
      { ...valid, category: 'comments' },
      { ...valid, channel: 'discord' },
      { ...valid, enabled: 'no' },
      { ...valid, memberId: 'someone-else' },
    ]) {
      expect(
        notificationPreferenceUpdateSchema.safeParse(invalid).success,
      ).toBe(false)
    }
    expect(
      notificationPreferencesSchema.safeParse({ mentions: { email: false } })
        .success,
    ).toBe(true)
  })
})
