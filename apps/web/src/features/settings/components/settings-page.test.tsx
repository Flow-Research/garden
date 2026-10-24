import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './settings-page'

const viewport = vi.hoisted(() => ({ mobile: false }))

vi.mock('@garden/ui/hooks/use-mobile', () => ({
  useIsMobile: () => viewport.mobile,
}))
vi.mock('./account-tab', () => ({ AccountTab: () => null }))
vi.mock('./appearance-tab', () => ({ AppearanceTab: () => null }))
vi.mock('./developer-tab', () => ({ DeveloperTab: () => null }))
vi.mock('./workspace-tab', () => ({ WorkspaceTab: () => null }))
vi.mock('./members-tab', () => ({ MembersTab: () => null }))

// The tablist's own data-orientation does not follow the root's, so read
// the root.
const tabsRoot = () => screen.getByRole('tablist').closest('[data-slot="tabs"]')

describe('SettingsPage navigation', () => {
  it('is a column beside the content on wide screens', () => {
    viewport.mobile = false
    render(<SettingsPage />)
    expect(tabsRoot()).toHaveAttribute('data-orientation', 'vertical')
  })

  it('is a row of tabs above the content on small screens', () => {
    viewport.mobile = true
    render(<SettingsPage />)
    const tabs = screen.getByRole('tablist')
    expect(tabsRoot()).toHaveAttribute('data-orientation', 'horizontal')
    // The horizontal list is h-8 by default, too short for these tabs.
    expect(tabs).toHaveClass('group-data-horizontal/tabs:h-auto')
    expect(tabs).not.toHaveClass('group-data-horizontal/tabs:h-8')
    expect(screen.getByRole('tab', { name: 'Members' })).not.toHaveClass(
      'w-full',
    )
  })
})
