import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const forceRefresh = vi.hoisted(() => vi.fn())
const updateSnapshot = vi.hoisted(
  () => ({ kind: 'update-available', version: 'release-b' }) as const,
)

vi.mock('@/lib/app-version', () => ({
  appVersionStore: {
    subscribe: () => () => undefined,
    getSnapshot: () => updateSnapshot,
    getServerSnapshot: () => updateSnapshot,
  },
  forceRefresh,
  removeRefreshMarker: vi.fn(),
}))

import { AppUpdateNotice } from './app-update-notice'

describe('AppUpdateNotice', () => {
  it('keeps the update action visible and refreshes to the discovered release', () => {
    render(<AppUpdateNotice />)

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Update available. Refresh Garden',
      }),
    )

    expect(screen.getByText('Update available')).toBeVisible()
    expect(forceRefresh).toHaveBeenCalledWith('release-b')
  })
})
