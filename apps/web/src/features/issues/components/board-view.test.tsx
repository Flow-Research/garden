import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Issue } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { BoardView } from './board-view'

type DndHandlers = {
  onDragStart?: (event: { active: { id: string } }) => void
  onDragOver?: (event: {
    active: { id: string }
    over: { id: string } | null
  }) => void
  onDragCancel?: () => void
  onDragEnd?: (event: {
    active: { id: string }
    over: { id: string } | null
  }) => void
}
const dnd = vi.hoisted(() => ({ handlers: {} as DndHandlers }))

vi.mock('@dnd-kit/core', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  DndContext: (props: DndHandlers & { children: ReactNode }) => {
    dnd.handlers = props
    return <>{props.children}</>
  },
  DragOverlay: () => null,
}))
vi.mock('./board-column', () => ({
  BoardColumn: ({
    status,
    issueIds,
  }: {
    status: string
    issueIds: string[]
  }) => <section aria-label={status}>{issueIds.join(',')}</section>,
}))
vi.mock('@garden/app-state/issues/stores/view-store-context', () => ({
  useViewStore: (selector: (state: object) => unknown) =>
    selector({ sortBy: 'position', sortDirection: 'asc' }),
}))
vi.mock('@/lib/issues/mutations', () => ({
  useLoadMoreDoneIssues: () => ({
    loadMore: vi.fn(),
    hasMore: false,
    isLoading: false,
    doneTotal: 0,
  }),
}))

function issue(id: string, status: Issue['status'], position = 'a0'): Issue {
  return {
    id,
    workspace_id: 'ws-1',
    number: 1,
    identifier: id,
    title: id,
    description: null,
    status,
    priority: 'none',
    project_id: null,
    team_id: null,
    parent_issue_id: null,
    position,
    assignee_type: null,
    assignee_id: null,
    creator_type: 'member',
    creator_id: 'user-1',
    due_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as Issue
}

describe('BoardView drag cancel', () => {
  it('puts the card back when a drag is cancelled', () => {
    const issues = [issue('A', 'todo'), issue('B', 'in_progress')]
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceIdProvider wsId="ws-1">
          <BoardView
            issues={issues}
            allIssues={issues}
            visibleStatuses={['todo', 'in_progress']}
            hiddenStatuses={[]}
            onMoveIssue={vi.fn()}
          />
        </WorkspaceIdProvider>
      </QueryClientProvider>,
    )

    act(() => {
      dnd.handlers.onDragStart?.({ active: { id: 'A' } })
      dnd.handlers.onDragOver?.({ active: { id: 'A' }, over: { id: 'B' } })
    })
    expect(
      screen.getByRole('region', { name: 'in_progress' }),
    ).toHaveTextContent('A,B')

    act(() => dnd.handlers.onDragCancel?.())

    expect(screen.getByRole('region', { name: 'todo' })).toHaveTextContent('A')
    expect(
      screen.getByRole('region', { name: 'in_progress' }),
    ).toHaveTextContent('B')
  })
})

describe('BoardView reordering', () => {
  it('drops a card between two adjacent cards', () => {
    // Positions 0 and 1 used to give 0.5, which the API rejected.
    const issues = [
      issue('A', 'todo', 'a0'),
      issue('B', 'todo', 'a1'),
      issue('C', 'todo', 'a2'),
    ]
    const onMoveIssue = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceIdProvider wsId="ws-1">
          <BoardView
            issues={issues}
            allIssues={issues}
            visibleStatuses={['todo']}
            hiddenStatuses={[]}
            onMoveIssue={onMoveIssue}
          />
        </WorkspaceIdProvider>
      </QueryClientProvider>,
    )

    // Move C onto B: C lands between A and B.
    act(() => {
      dnd.handlers.onDragStart?.({ active: { id: 'C' } })
      dnd.handlers.onDragEnd?.({ active: { id: 'C' }, over: { id: 'B' } })
    })

    expect(onMoveIssue).toHaveBeenCalledTimes(1)
    const [id, status, key] = onMoveIssue.mock.calls[0] as [
      string,
      string,
      string,
    ]
    expect([id, status]).toEqual(['C', 'todo'])
    expect(key > 'a0' && key < 'a1').toBe(true)
  })
})
