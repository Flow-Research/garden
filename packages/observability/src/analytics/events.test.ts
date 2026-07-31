import { describe, expect, it } from 'vitest'
import {
  GARDEN_ANALYTICS_EVENTS,
  GARDEN_POSTHOG_GROUP_TYPE,
  resolveGardenAnalyticsEnvironment,
} from './events'

describe('Garden analytics contracts', () => {
  it('keeps event names unique and workspace as the canonical group', () => {
    const events = Object.values(GARDEN_ANALYTICS_EVENTS)

    expect(new Set(events).size).toBe(events.length)
    expect(GARDEN_POSTHOG_GROUP_TYPE).toBe('workspace')
  })

  it('resolves explicit deployment environments', () => {
    expect(resolveGardenAnalyticsEnvironment({ environment: 'staging' })).toBe(
      'staging',
    )
    expect(
      resolveGardenAnalyticsEnvironment({ environment: 'production' }),
    ).toBe('production')
  })

  it('derives browser environments without treating local traffic as production', () => {
    expect(resolveGardenAnalyticsEnvironment({ hostname: 'localhost' })).toBe(
      'development',
    )
    expect(
      resolveGardenAnalyticsEnvironment({
        hostname: 'garden-staging.example.com',
      }),
    ).toBe('staging')
    expect(
      resolveGardenAnalyticsEnvironment({
        hostname: 'garden-preview.julian-duru.workers.dev',
      }),
    ).toBe('staging')
    expect(
      resolveGardenAnalyticsEnvironment({ hostname: 'app.garden.example.com' }),
    ).toBe('production')
  })
})
