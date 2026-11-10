import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User, Workspace } from '@garden/core/types'
import {
  configureWorkspaceStore,
  useWorkspaceStore,
} from '@garden/app-state/workspace'
import { Route as authenticatedRoute } from '@/routes/_authenticated'
import { Route as invitationRoute } from '@/routes/_authenticated/invitations/$id'
import { workspaceKeys, workspaceListOptions } from './queries'
import { useCreateWorkspace } from './mutations'

const server = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  acceptInvitation: vi.fn(),
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    createWorkspace: server.createWorkspace,
    listWorkspaces: server.listWorkspaces,
  },
  listConnections: vi.fn(),
}))
vi.mock('@/lib/server/auth-bootstrap', () => ({
  getAuthBootstrap: server.bootstrap,
}))
vi.mock('@/lib/server/invitations', () => ({
  acceptInvitationForCurrentUser: server.acceptInvitation,
}))
vi.mock('@/lib/realtime/realtime-manager', () => ({ initRealtime: vi.fn() }))
vi.mock('@/lib/posthog-browser', () => ({ synchronizePostHogContext: vi.fn() }))
vi.mock('@/lib/auth/client', () => ({ authClient: { signOut: vi.fn() } }))

const oldWorkspace: Workspace = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Existing workspace',
  slug: 'existing',
  description: null,
  context: null,
  settings: {},
  issue_prefix: 'EX',
  created_at: '2026-11-10T00:00:00.000Z',
  updated_at: '2026-11-10T00:00:00.000Z',
}
const invitedWorkspace: Workspace = {
  ...oldWorkspace,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Invited workspace',
  slug: 'invited',
}
const user: User = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Workspace member',
  email: 'member@example.test',
  avatar_url: null,
  created_at: oldWorkspace.created_at,
  updated_at: oldWorkspace.updated_at,
}
const invitationId = '44444444-4444-4444-8444-444444444444'
const clients: QueryClient[] = []

/** Observes the same query/store pair the account workspace menu consumes. */
function MembershipView() {
  const memberships = useQuery(workspaceListOptions())
  const active = useWorkspaceStore((state) => state.workspace)
  const create = useCreateWorkspace()
  return (
    <section>
      <output aria-label="Active workspace">{active?.name}</output>
      <ul aria-label="Workspaces">
        {memberships.data?.map((workspace) => (
          <li key={workspace.id}>{workspace.name}</li>
        ))}
      </ul>
      <button
        onClick={() =>
          create.mutate({
            name: invitedWorkspace.name,
            slug: invitedWorkspace.slug,
          })
        }
      >
        Create workspace
      </button>
    </section>
  )
}

/**
 * Runs the real authenticated and invitation route options through memory
 * history. Cached parent loaders previously survived invite redirects, so a
 * server-only acceptance test could not expose the missing membership in UI.
 */
function startMembershipRouter(initialEntry = '/home') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  clients.push(queryClient)
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()()
  const auth = createRoute({
    ...authenticatedRoute.options,
    getParentRoute: () => root,
    id: '/_authenticated',
  })
  const home = createRoute({
    getParentRoute: () => auth,
    path: 'home',
    component: MembershipView,
  })
  const invite = createRoute({
    ...invitationRoute.options,
    getParentRoute: () => auth,
    path: '/invitations/$id',
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([home, invite])]),
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, queryClient, view }
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  server.bootstrap.mockReset()
  server.acceptInvitation.mockReset()
  server.createWorkspace.mockReset()
  server.listWorkspaces.mockResolvedValue([oldWorkspace])
  configureWorkspaceStore({
    setWorkspaceHeader: vi.fn(),
    setWorkspaceId: vi.fn(),
  })
  useWorkspaceStore.setState({ workspace: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  for (const client of clients.splice(0)) client.clear()
})

describe('membership changes through client navigation', () => {
  it('waits for navigation before selecting a preloaded workspace destination', async () => {
    server.bootstrap.mockImplementation(async (workspaceId?: string) => ({
      user,
      preferredWorkspaceId: workspaceId ?? oldWorkspace.id,
      workspaces: workspaceId
        ? [oldWorkspace, invitedWorkspace]
        : [oldWorkspace],
    }))
    const { router } = startMembershipRouter()
    await waitFor(() =>
      expect(screen.getByLabelText('Active workspace')).toHaveTextContent(
        oldWorkspace.name,
      ),
    )

    await act(() =>
      router.preloadRoute({
        to: '/home',
        search: { workspace_id: invitedWorkspace.id },
      }),
    )

    expect(useWorkspaceStore.getState().workspace?.id).toBe(oldWorkspace.id)
    await act(() =>
      router.navigate({
        to: '/home',
        search: { workspace_id: invitedWorkspace.id },
      }),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Active workspace')).toHaveTextContent(
        invitedWorkspace.name,
      ),
    )
    expect(server.bootstrap).toHaveBeenCalledTimes(2)
  })

  it('shows and selects a created workspace through the real mutation and router', async () => {
    let memberships = [oldWorkspace]
    server.bootstrap.mockImplementation(async (workspaceId?: string) => ({
      user,
      preferredWorkspaceId: workspaceId ?? oldWorkspace.id,
      workspaces: memberships,
    }))
    server.listWorkspaces.mockImplementation(async () => memberships)
    server.createWorkspace.mockImplementation(async () => {
      memberships = [oldWorkspace, invitedWorkspace]
      return invitedWorkspace
    })
    const { router, queryClient } = startMembershipRouter()
    await waitFor(() =>
      expect(screen.getByLabelText('Active workspace')).toHaveTextContent(
        oldWorkspace.name,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Active workspace')).toHaveTextContent(
        invitedWorkspace.name,
      ),
    )
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        workspace_id: invitedWorkspace.id,
      }),
    )
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([
      oldWorkspace,
      invitedWorkspace,
    ])
    expect(server.bootstrap).toHaveBeenLastCalledWith(invitedWorkspace.id)
  })

  it('does not restore an old bootstrap snapshot when authenticated layout remounts', async () => {
    server.bootstrap.mockResolvedValue({
      user,
      preferredWorkspaceId: oldWorkspace.id,
      workspaces: [oldWorkspace],
    })
    const { router, queryClient, view } = startMembershipRouter()
    await waitFor(() =>
      expect(screen.getByLabelText('Active workspace')).toHaveTextContent(
        oldWorkspace.name,
      ),
    )
    await act(async () => {
      queryClient.setQueryData(workspaceKeys.list(), [
        oldWorkspace,
        invitedWorkspace,
      ])
      useWorkspaceStore
        .getState()
        .hydrateWorkspace([oldWorkspace, invitedWorkspace], invitedWorkspace.id)
    })

    view.unmount()
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      )
    })

    await waitFor(() =>
      expect(screen.getByLabelText('Active workspace')).toHaveTextContent(
        invitedWorkspace.name,
      ),
    )
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([
      oldWorkspace,
      invitedWorkspace,
    ])
    expect(server.bootstrap).toHaveBeenCalledTimes(1)
  })

  it('refreshes a warm authenticated route after accepting an invitation', async () => {
    let accepted = false
    server.bootstrap.mockImplementation(async () => ({
      user,
      preferredWorkspaceId: accepted ? invitedWorkspace.id : oldWorkspace.id,
      workspaces: accepted ? [oldWorkspace, invitedWorkspace] : [oldWorkspace],
    }))
    server.acceptInvitation.mockImplementation(async () => {
      accepted = true
      return { status: 'accepted', workspaceId: invitedWorkspace.id }
    })
    const { router, queryClient } = startMembershipRouter()
    await waitFor(() =>
      expect(screen.getByLabelText('Active workspace')).toHaveTextContent(
        oldWorkspace.name,
      ),
    )

    await act(() =>
      router.navigate({ to: '/invitations/$id', params: { id: invitationId } }),
    )

    await waitFor(() =>
      expect(screen.getByLabelText('Active workspace')).toHaveTextContent(
        invitedWorkspace.name,
      ),
    )
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([
      oldWorkspace,
      invitedWorkspace,
    ])
    expect(server.bootstrap).toHaveBeenLastCalledWith(invitedWorkspace.id)
    expect(server.bootstrap).toHaveBeenNthCalledWith(1, undefined)
    expect(router.state.location.pathname).toBe('/home')
  })

  it('refreshes a cold invite whose parent bootstrap started before acceptance', async () => {
    let accepted = false
    server.bootstrap.mockImplementation(async () => ({
      user,
      preferredWorkspaceId: accepted ? invitedWorkspace.id : oldWorkspace.id,
      workspaces: accepted ? [oldWorkspace, invitedWorkspace] : [oldWorkspace],
    }))
    server.acceptInvitation.mockImplementation(async () => {
      accepted = true
      return { status: 'accepted', workspaceId: invitedWorkspace.id }
    })
    const { queryClient } = startMembershipRouter(
      `/invitations/${invitationId}`,
    )

    await waitFor(() =>
      expect(screen.getByLabelText('Active workspace')).toHaveTextContent(
        invitedWorkspace.name,
      ),
    )
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([
      oldWorkspace,
      invitedWorkspace,
    ])
    expect(server.bootstrap).toHaveBeenLastCalledWith(invitedWorkspace.id)
    expect(server.bootstrap).toHaveBeenNthCalledWith(1, undefined)
  })

  it('does not change membership or active workspace for an unavailable invitation', async () => {
    server.bootstrap.mockResolvedValue({
      user,
      preferredWorkspaceId: oldWorkspace.id,
      workspaces: [oldWorkspace],
    })
    server.acceptInvitation.mockResolvedValue({
      status: 'unavailable',
      reason: 'expired',
      message: 'This invitation expired.',
    })
    const { router, queryClient } = startMembershipRouter()
    await waitFor(() =>
      expect(screen.getByLabelText('Active workspace')).toHaveTextContent(
        oldWorkspace.name,
      ),
    )

    await act(() =>
      router.navigate({ to: '/invitations/$id', params: { id: invitationId } }),
    )

    expect(
      await screen.findByText('This invitation expired.'),
    ).toBeInTheDocument()
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([
      oldWorkspace,
    ])
    expect(useWorkspaceStore.getState().workspace?.id).toBe(oldWorkspace.id)
  })
})
