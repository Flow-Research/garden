import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { Option } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { workspaceKeys } from '@/lib/workspace/queries'
import { ConnectionsPage } from './connections-page'

const WS_ID = 'ws-1'

vi.mock('@/lib/api/executor', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  searchRegistry: vi.fn(async () => ({
    entries: [{ providerId: 'github', name: 'GitHub' }],
    total: 1,
    nextOffset: Option.none(),
  })),
}))
vi.mock('@garden/ui/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid="drawer">{children}</div> : null,
  DrawerContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('./manage-drawer-body', () => ({
  ManageDrawerBody: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      Close manage drawer
    </button>
  ),
}))
vi.mock('./featured-card', () => ({
  FeaturedCard: () => null,
  FeaturedSkeleton: () => null,
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(workspaceKeys.connections(WS_ID), {
    integrations: [
      {
        slug: 'github',
        providerId: 'github',
        name: 'GitHub',
        canRemove: true,
        connections: [],
      },
    ],
  })
  const ui = (
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId={WS_ID}>
        <ConnectionsPage focusedConnectorId="github" />
      </WorkspaceIdProvider>
    </QueryClientProvider>
  )
  const result = render(ui)
  return { rerender: () => result.rerender(ui) }
}

describe('ConnectionsPage focused connector', () => {
  it('opens the drawer from connector_id once and lets it be closed', async () => {
    const page = renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Close manage drawer' }),
    )
    page.rerender()

    expect(screen.queryByTestId('drawer')).toBeNull()
  })
})
