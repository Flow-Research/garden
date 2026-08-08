import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Issue } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { issueKeys } from '@/lib/issues/queries'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @garden/app-state/auth
const mockAuthUser = { id: 'user-1', email: 'test@test.com', name: 'Test User' }
vi.mock('@garden/app-state/auth', () => ({
  useAuthStore: Object.assign(
    (selector?: any) => {
      const state = { user: mockAuthUser, isAuthenticated: true }
      return selector ? selector(state) : state
    },
    { getState: () => ({ user: mockAuthUser, isAuthenticated: true }) },
  ),
}))

// Mock @garden/app-state/workspace
vi.mock('@garden/app-state/workspace', () => ({
  useWorkspaceStore: Object.assign(
    (selector?: any) => {
      const state = {
        workspace: { id: 'ws-1', name: 'Test WS', slug: 'test' },
        agents: [],
        members: [],
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        workspace: { id: 'ws-1', name: 'Test WS', slug: 'test' },
        agents: [],
        members: [],
      }),
    },
  ),
}))

// Mock the application navigation boundary (AppLink + useNavigation).
vi.mock('../../navigation', () => ({
  AppLink: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useNavigation: () => ({
    push: vi.fn(),
    pathname: '/issues',
    searchParams: new URLSearchParams(),
  }),
  NavigationProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock workspace avatar
vi.mock('../../workspace/workspace-avatar', () => ({
  WorkspaceAvatar: ({ name }: { name: string }) => (
    <span data-testid="workspace-avatar">{name.charAt(0)}</span>
  ),
}))

// Mock api (queries use api internally)
const mockListIssues = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ issues: [], total: 0 }),
)
const mockSearchIssues = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ issues: [], total: 0 }),
)
vi.mock('@/lib/api', () => ({
  api: {
    listIssues: (...args: any[]) => mockListIssues(...args),
    searchIssues: (...args: any[]) => mockSearchIssues(...args),
    updateIssue: vi.fn(),
    getChildIssueProgress: () => Promise.resolve({ progress: [] }),
    listMembers: () => Promise.resolve([]),
    listAgents: () => Promise.resolve([]),
  },
  getApi: () => ({
    listIssues: (...args: any[]) => mockListIssues(...args),
    searchIssues: (...args: any[]) => mockSearchIssues(...args),
    updateIssue: vi.fn(),
    getChildIssueProgress: () => Promise.resolve({ progress: [] }),
    listMembers: () => Promise.resolve([]),
    listAgents: () => Promise.resolve([]),
  }),
}))

// Mock issue config
vi.mock('@garden/core/issues/config', () => ({
  ALL_STATUSES: [
    'todo',
    'in_progress',
    'in_review',
    'done',
    'blocked',
    'cancelled',
  ],
  BOARD_STATUSES: ['blocked', 'todo', 'in_progress', 'in_review', 'done'],
  STATUS_ORDER: [
    'todo',
    'in_progress',
    'in_review',
    'done',
    'blocked',
    'cancelled',
  ],
  STATUS_CONFIG: {
    todo: {
      label: 'Todo',
      iconColor: 'text-muted-foreground',
      hoverBg: 'hover:bg-accent',
    },
    in_progress: {
      label: 'In Progress',
      iconColor: 'text-warning',
      hoverBg: 'hover:bg-warning/10',
    },
    in_review: {
      label: 'In Review',
      iconColor: 'text-success',
      hoverBg: 'hover:bg-success/10',
    },
    done: {
      label: 'Done',
      iconColor: 'text-info',
      hoverBg: 'hover:bg-info/10',
    },
    blocked: {
      label: 'Blocked',
      iconColor: 'text-destructive',
      hoverBg: 'hover:bg-destructive/10',
    },
    cancelled: {
      label: 'Cancelled',
      iconColor: 'text-muted-foreground',
      hoverBg: 'hover:bg-accent',
    },
  },
  PRIORITY_ORDER: ['urgent', 'high', 'medium', 'low', 'none'],
  PRIORITY_CONFIG: {
    urgent: { label: 'Urgent', bars: 4, color: 'text-destructive' },
    high: { label: 'High', bars: 3, color: 'text-warning' },
    medium: { label: 'Medium', bars: 2, color: 'text-warning' },
    low: { label: 'Low', bars: 1, color: 'text-info' },
    none: { label: 'No priority', bars: 0, color: 'text-muted-foreground' },
  },
}))

// Mock view store
const mockViewState = {
  viewMode: 'board' as const,
  statusFilters: [] as string[],
  priorityFilters: [] as string[],
  assigneeFilters: [] as { type: string; id: string }[],
  includeNoAssignee: false,
  creatorFilters: [] as { type: string; id: string }[],
  projectFilters: [] as string[],
  includeNoProject: false,
  sortBy: 'position' as const,
  sortDirection: 'asc' as const,
  cardProperties: {
    priority: true,
    description: true,
    assignee: true,
    dueDate: true,
  },
  listCollapsedStatuses: [] as string[],
  setViewMode: vi.fn(),
  toggleStatusFilter: vi.fn(),
  togglePriorityFilter: vi.fn(),
  toggleAssigneeFilter: vi.fn(),
  toggleNoAssignee: vi.fn(),
  toggleCreatorFilter: vi.fn(),
  toggleProjectFilter: vi.fn(),
  toggleNoProject: vi.fn(),
  hideStatus: vi.fn(),
  showStatus: vi.fn(),
  clearFilters: vi.fn(),
  setSortBy: vi.fn(),
  setSortDirection: vi.fn(),
  toggleCardProperty: vi.fn(),
  toggleListCollapsed: vi.fn(),
}

vi.mock('@garden/app-state/issues/stores/view-store', () => ({
  initFilterWorkspaceSync: vi.fn(),
  registerViewStoreForWorkspaceSync: vi.fn(),
  viewStorePersistOptions: () => ({
    name: 'test',
    storage: undefined,
    partialize: (s: any) => s,
  }),
  viewStoreSlice: vi.fn(),
  useIssueViewStore: Object.assign(
    (selector?: any) => (selector ? selector(mockViewState) : mockViewState),
    { getState: () => mockViewState, setState: vi.fn() },
  ),
  createIssueViewStore: () => ({
    getState: () => mockViewState,
    setState: vi.fn(),
    subscribe: vi.fn(),
  }),
  SORT_OPTIONS: [
    { value: 'position', label: 'Manual' },
    { value: 'priority', label: 'Priority' },
    { value: 'due_date', label: 'Due date' },
    { value: 'created_at', label: 'Created date' },
    { value: 'title', label: 'Title' },
  ],
  CARD_PROPERTY_OPTIONS: [
    { key: 'priority', label: 'Priority' },
    { key: 'description', label: 'Description' },
    { key: 'assignee', label: 'Assignee' },
    { key: 'dueDate', label: 'Due date' },
  ],
}))

vi.mock('@garden/app-state/issues/stores/view-store-context', () => ({
  ViewStoreProvider: ({ children }: { children: React.ReactNode }) => children,
  useViewStore: (selector?: any) =>
    selector ? selector(mockViewState) : mockViewState,
  useViewStoreApi: () => ({
    getState: () => mockViewState,
    setState: vi.fn(),
    subscribe: vi.fn(),
  }),
}))

vi.mock('@garden/app-state/issues/stores/issues-scope-store', () => ({
  useIssuesScopeStore: Object.assign(
    (selector?: any) => {
      const state = { scope: 'all', setScope: vi.fn() }
      return selector ? selector(state) : state
    },
    { getState: () => ({ scope: 'all', setScope: vi.fn() }) },
  ),
}))

vi.mock('@garden/app-state/issues/stores/selection-store', () => ({
  useIssueSelectionStore: Object.assign(
    (selector?: any) => {
      const state = {
        selectedIds: new Set(),
        toggle: vi.fn(),
        clear: vi.fn(),
        setAll: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        selectedIds: new Set(),
        toggle: vi.fn(),
        clear: vi.fn(),
        setAll: vi.fn(),
      }),
    },
  ),
}))

vi.mock('@garden/app-state/issues/stores/recent-issues-store', () => ({
  useRecentIssuesStore: Object.assign(
    (selector?: any) => {
      const state = { items: [], recordVisit: vi.fn() }
      return selector ? selector(state) : state
    },
    { getState: () => ({ items: [], recordVisit: vi.fn() }) },
  ),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

// Mock dnd-kit
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => children,
  DragOverlay: () => null,
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  pointerWithin: vi.fn(),
  closestCenter: vi.fn(),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => children,
  verticalListSortingStrategy: {},
  arrayMove: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

// Base UI floating primitives schedule positioning work that belongs to their
// own component tests. This page suite only needs their trigger controls, and
// keeping the portals out prevents teardown updates from leaking across tests.
vi.mock('@garden/ui/components/ui/popover', () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children, render }: any) => render ?? children ?? null,
  PopoverContent: () => null,
}))

vi.mock('@garden/ui/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <>{children}</>,
  DropdownMenuTrigger: ({ children, render }: any) =>
    render ?? children ?? null,
  DropdownMenuContent: () => null,
  DropdownMenuItem: ({ children }: any) => <>{children}</>,
}))

vi.mock('@garden/ui/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children, render }: any) => render ?? children ?? null,
  TooltipContent: () => null,
}))

// Mock @base-ui/react/accordion (used by ListView)
vi.mock('@base-ui/react/accordion', () => ({
  Accordion: Object.assign(({ children }: any) => <div>{children}</div>, {
    Root: ({ children }: any) => <div>{children}</div>,
    Item: ({ children }: any) => <div>{children}</div>,
    Header: ({ children }: any) => <div>{children}</div>,
    Trigger: ({ children }: any) => <button>{children}</button>,
    Panel: ({ children }: any) => <div>{children}</div>,
  }),
}))

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const issueDefaults = {
  parent_issue_id: null,
  project_id: null,
  position: 0,
}

const mockIssues: Issue[] = [
  {
    ...issueDefaults,
    id: 'issue-1',
    workspace_id: 'ws-1',
    number: 1,
    identifier: 'TES-1',
    title: 'Implement auth',
    description: 'Add JWT authentication',
    status: 'todo',
    priority: 'high',
    assignee_type: 'member',
    assignee_id: 'user-1',
    creator_type: 'member',
    creator_id: 'user-1',
    due_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    ...issueDefaults,
    id: 'issue-2',
    workspace_id: 'ws-1',
    number: 2,
    identifier: 'TES-2',
    title: 'Design landing page',
    description: null,
    status: 'in_progress',
    priority: 'medium',
    assignee_type: 'agent',
    assignee_id: 'agent-1',
    creator_type: 'member',
    creator_id: 'user-1',
    due_date: '2026-02-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    ...issueDefaults,
    id: 'issue-3',
    workspace_id: 'ws-1',
    number: 3,
    identifier: 'TES-3',
    title: 'Write tests',
    description: null,
    status: 'todo',
    priority: 'low',
    assignee_type: null,
    assignee_id: null,
    creator_type: 'member',
    creator_id: 'user-1',
    due_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

// ---------------------------------------------------------------------------
// Import component under test (after mocks)
// ---------------------------------------------------------------------------

import { IssuesPage } from './issues-page'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Gives search-focused cases a warm issue-list cache so they exercise only
 * the deferred authoritative-search transition, not unrelated suspense I/O.
 */
function renderWithQuery(
  ui: React.ReactElement,
  initialIssues?: readonly Issue[],
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  if (initialIssues) {
    qc.setQueryData(issueKeys.list('ws-1'), {
      issues: initialIssues,
      total: initialIssues.length,
      doneTotal: initialIssues.filter((issue) => issue.status === 'done')
        .length,
    })
    qc.setQueryData(issueKeys.childProgress('ws-1'), { progress: [] })
  }
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceIdProvider wsId="ws-1">{ui}</WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IssuesPage (shared)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListIssues.mockResolvedValue({ issues: [], total: 0 })
    mockSearchIssues.mockResolvedValue({ issues: [], total: 0 })
    mockViewState.viewMode = 'board'
    mockViewState.statusFilters = []
    mockViewState.priorityFilters = []
  })

  it('shows loading skeletons initially', () => {
    renderWithQuery(<IssuesPage />)
    expect(
      document.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0)
  })

  it('renders issue titles after data loads', async () => {
    mockListIssues.mockImplementation((params: any) =>
      Promise.resolve(
        params?.open_only
          ? { issues: mockIssues, total: mockIssues.length }
          : { issues: [], total: 0 },
      ),
    )

    renderWithQuery(<IssuesPage />)

    await screen.findByText('Implement auth')
    expect(screen.getByText('Design landing page')).toBeInTheDocument()
    expect(screen.getByText('Write tests')).toBeInTheDocument()
  })

  it('renders board column headers', async () => {
    mockListIssues.mockImplementation((params: any) =>
      Promise.resolve(
        params?.open_only
          ? { issues: mockIssues, total: mockIssues.length }
          : { issues: [], total: 0 },
      ),
    )

    renderWithQuery(<IssuesPage />)

    expect((await screen.findAllByText('Todo')).length).toBeGreaterThanOrEqual(
      1,
    )
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1)
  })

  it("shows workspace breadcrumb with 'Issues' label", async () => {
    mockListIssues.mockImplementation((params: any) =>
      Promise.resolve(
        params?.open_only
          ? { issues: mockIssues, total: mockIssues.length }
          : { issues: [], total: 0 },
      ),
    )

    renderWithQuery(<IssuesPage />)

    await screen.findByText('Test WS')
    expect(screen.getByText('Issues')).toBeInTheDocument()
  })

  it('shows empty state when there are no issues', async () => {
    mockListIssues.mockResolvedValue({ issues: [], total: 0 })

    renderWithQuery(<IssuesPage />)

    await screen.findByText('Todo')
    expect(screen.getAllByText('No issues').length).toBeGreaterThanOrEqual(1)
  })

  it('searches authoritative issue results and exposes structured filters', async () => {
    mockListIssues.mockImplementation((params: any) =>
      Promise.resolve(
        params?.open_only
          ? { issues: mockIssues, total: mockIssues.length }
          : { issues: [], total: 0 },
      ),
    )
    mockSearchIssues.mockResolvedValue({
      issues: [mockIssues[1]],
      total: 1,
    })

    renderWithQuery(<IssuesPage />, mockIssues)

    const search = await screen.findByRole('textbox', {
      name: 'Search issues',
    })
    expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'landing' } })

    await waitFor(() => {
      expect(mockSearchIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'landing',
          include_closed: true,
          workspace_id: 'ws-1',
        }),
      )
    })

    expect(await screen.findByText('Design landing page')).toBeInTheDocument()
    expect(screen.queryByText('Implement auth')).not.toBeInTheDocument()
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear issue search' }))
    expect(await screen.findByText('Implement auth')).toBeInTheDocument()
  })

  it('loads every authoritative search page', async () => {
    const firstMatch = {
      ...mockIssues[2],
      id: 'archived-1',
      title: 'Archived launch notes',
      status: 'done' as const,
    }
    const secondMatch = {
      ...mockIssues[2],
      id: 'archived-2',
      title: 'Archived launch decision',
      status: 'done' as const,
    }
    mockSearchIssues.mockImplementation(({ offset = 0 }: { offset?: number }) =>
      Promise.resolve({
        issues: offset === 0 ? [firstMatch] : [secondMatch],
        total: 2,
      }),
    )

    renderWithQuery(<IssuesPage />, mockIssues)
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Search issues' }),
      { target: { value: 'archived' } },
    )

    expect(await screen.findByText('Archived launch decision')).toBeVisible()
    expect(mockSearchIssues).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 1, include_closed: true }),
    )
  })

  it('shows scope tab buttons', async () => {
    renderWithQuery(<IssuesPage />)

    await screen.findByText('All')
    expect(screen.getByText('Members')).toBeInTheDocument()
    expect(screen.getByText('Agents')).toBeInTheDocument()
  })
})
