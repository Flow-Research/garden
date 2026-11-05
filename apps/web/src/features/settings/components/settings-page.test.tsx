import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workspaceKeys } from '@/lib/workspace/queries'
import { useSettingsDialogStore } from '../settings-dialog-store'
import { SettingsPage } from './settings-page'

const viewport = vi.hoisted(() => ({ mobile: false }))
const navigate = vi.hoisted(() => vi.fn())

vi.mock('@garden/ui/hooks/use-mobile', () => ({
  useIsMobile: () => viewport.mobile,
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))
vi.mock('@garden/app-state/workspace', () => ({
  useWorkspaceStore: (
    select: (state: { workspace: { id: string; name: string } }) => unknown,
  ) => select({ workspace: { id: 'ws-1', name: 'Flow Research' } }),
}))
vi.mock('@garden/app-state/auth', () => ({
  useAuthStore: (select: (state: { user: { id: string } }) => unknown) =>
    select({ user: { id: 'user-1' } }),
}))
vi.mock('@/lib/api', () => ({
  api: { listMembers: vi.fn(() => new Promise(() => {})) },
}))
vi.mock('./account-tab', () => ({ AccountTab: () => null }))
vi.mock('./appearance-tab', () => ({ AppearanceTab: () => null }))
vi.mock('./developer-tab', () => ({
  DeveloperTab: () => <p>Developer content</p>,
}))
vi.mock('./workspace-tab', () => ({ WorkspaceTab: () => null }))
vi.mock('./members-tab', () => ({ MembersTab: () => null }))

/** Seeds the workspace member list so the caller has the given role. */
function renderWithRole(role: string | null, ui: ReactNode = <SettingsPage />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (role) {
    queryClient.setQueryData(workspaceKeys.members('ws-1'), [
      { user_id: 'user-1', role },
    ])
  }
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

// The tablist's own data-orientation does not follow the root's, so read
// the root.
const tabsRoot = () => screen.getByRole('tablist').closest('[data-slot="tabs"]')

beforeEach(() => {
  navigate.mockReset()
  viewport.mobile = false
  useSettingsDialogStore.setState({ open: true, activeTab: 'profile' })
})

describe('SettingsPage navigation', () => {
  it('is a column beside the content on wide screens', () => {
    renderWithRole('member')
    expect(tabsRoot()).toHaveAttribute('data-orientation', 'vertical')
  })

  it('is a row of tabs above the content on small screens', () => {
    viewport.mobile = true
    renderWithRole('member')
    const tabs = screen.getByRole('tablist')
    expect(tabsRoot()).toHaveAttribute('data-orientation', 'horizontal')
    // The horizontal list is h-8 by default, too short for these tabs.
    expect(tabs).toHaveClass('group-data-horizontal/tabs:h-auto')
    expect(tabs).not.toHaveClass('group-data-horizontal/tabs:h-8')
    expect(screen.getByRole('tab', { name: 'Members' })).not.toHaveClass(
      'w-full',
    )
  })

  it('shows the tab it is given and reports tab changes', () => {
    const onValueChange = vi.fn()
    renderWithRole(
      'member',
      <SettingsPage value="developer" onValueChange={onValueChange} />,
    )
    expect(screen.getByText('Developer content')).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
    expect(onValueChange).toHaveBeenCalledWith('members')
  })
})

describe('SettingsPage Teams entry', () => {
  it.each(['owner', 'admin'])('shows Teams to a workspace %s', (role) => {
    renderWithRole(role)
    expect(screen.getByRole('button', { name: 'Teams' })).toBeVisible()
  })

  it('hides Teams from a normal member', () => {
    renderWithRole('member')
    expect(screen.queryByRole('button', { name: 'Teams' })).toBeNull()
  })

  it('hides Teams while the role is still loading', () => {
    renderWithRole(null)
    expect(screen.queryByRole('button', { name: 'Teams' })).toBeNull()
  })

  it('closes Settings before it navigates to /teams', () => {
    renderWithRole('admin')
    navigate.mockImplementation(() => {
      // The Teams route must not mount under an open modal.
      expect(useSettingsDialogStore.getState().open).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Teams' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/teams' })
  })
})

describe('Settings dialog store', () => {
  it('reopens on the last selected tab', () => {
    const store = useSettingsDialogStore.getState()
    store.openSettings('developer')
    store.closeSettings()
    useSettingsDialogStore.getState().openSettings()
    expect(useSettingsDialogStore.getState().activeTab).toBe('developer')
  })

  it('opens on a deep-linked tab', () => {
    useSettingsDialogStore.getState().openSettings('members')
    expect(useSettingsDialogStore.getState()).toMatchObject({
      open: true,
      activeTab: 'members',
    })
  })
})
