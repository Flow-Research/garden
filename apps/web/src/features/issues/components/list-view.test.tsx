import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Issue } from '@garden/core/types'
import { ListView } from './list-view'

const mockViewState = {
  sortBy: 'position' as const,
  sortDirection: 'asc' as const,
  listCollapsedStatuses: [] as string[],
  toggleListCollapsed: vi.fn(),
}

vi.mock('@garden/app-state/issues/stores/view-store-context', () => ({
  ViewStoreProvider: ({ children }: { children: React.ReactNode }) => children,
  useViewStore: (selector?: (state: typeof mockViewState) => unknown) =>
    selector ? selector(mockViewState) : mockViewState,
  useViewStoreApi: () => ({
    getState: () => mockViewState,
    setState: vi.fn(),
    subscribe: vi.fn(),
  }),
}))

vi.mock('@garden/app-state/issues/stores/selection-store', () => ({
  useIssueSelectionStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      selectedIds: new Set<string>(),
      select: vi.fn(),
      deselect: vi.fn(),
      toggle: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/lib/issues/mutations', () => ({
  useLoadMoreDoneIssues: () => ({
    loadMore: vi.fn(),
    hasMore: false,
    isLoading: false,
    doneTotal: 0,
  }),
}))

vi.mock('@/features/navigation/use-surface-navigation', () => ({
  useSurfaceNavigation: () => ({ openIssue: vi.fn() }),
}))

vi.mock('../../common/actor-avatar', () => ({
  ActorAvatar: () => <span data-testid="actor-avatar" />,
}))

vi.mock('@garden/ui/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    children,
    render,
  }: {
    children: React.ReactNode
    render?: React.ReactElement
  }) => render ?? children ?? null,
  TooltipContent: () => null,
}))

vi.mock('@base-ui/react/accordion', () => ({
  Accordion: Object.assign(({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ), {
    Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Trigger: ({ children }: { children: React.ReactNode }) => (
      <button>{children}</button>
    ),
    Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }),
}))

const issueDefaults = {
  parent_issue_id: null,
  position: 0,
}

function makeIssue(overrides: Partial<Issue>): Issue {
  return {
    ...issueDefaults,
    id: 'issue-1',
    workspace_id: 'ws-1',
    number: 1,
    identifier: 'TES-1',
    title: 'Implement auth',
    description: 'Add JWT authentication',
    status: 'todo',
    priority: 'high',
    project_id: null,
    assignee_type: null,
    assignee_id: null,
    creator_type: 'member',
    creator_id: 'user-1',
    due_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('ListView variants', () => {
  it('default variant keeps batch selection checkboxes', () => {
    render(<ListView issues={[makeIssue({})]} visibleStatuses={['todo']} />)

    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Select issue')).toBeInTheDocument()
    expect(screen.getByText('TES-1')).toBeInTheDocument()
  })

  it('team variant drops checkboxes and renders the design row chips', () => {
    render(
      <ListView
        issues={[
          makeIssue({ id: 'issue-1' }),
          makeIssue({
            id: 'issue-2',
            number: 2,
            identifier: 'TES-2',
            title: 'Design landing page',
            description: null,
          }),
        ]}
        projects={
          new Map([['project-1', { title: 'Research', color: 'blue' }]])
        }
        teamChips={
          new Map([
            ['issue-1', { name: 'Engineering', color: 'orange' }],
          ])
        }
        variant="team"
        visibleStatuses={['todo']}
      />,
    )

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('TES-1')).not.toBeInTheDocument()
    expect(screen.getByText('Todo')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Implement auth')).toBeInTheDocument()
    expect(screen.getByText('Add JWT authentication')).toBeInTheDocument()
    expect(screen.getByText('Engineering')).toBeInTheDocument()
  })

  it('team variant renders the project chip when the issue has a project', () => {
    render(
      <ListView
        issues={[makeIssue({ project_id: 'project-1', description: null })]}
        projects={
          new Map([['project-1', { title: 'Research', color: 'blue' }]])
        }
        variant="team"
        visibleStatuses={['todo']}
      />,
    )

    expect(screen.getByText('Research')).toBeInTheDocument()
  })
})
