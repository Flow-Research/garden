import {
  forwardRef,
  useRef,
  useState,
  useImperativeHandle,
  type ComponentProps,
} from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Issue, TimelineEntry } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import type {
  MockContentEditorHandle,
  MockEditorProps,
  MockSelector,
} from '@/test/mock-props'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @garden/app-state/auth
const mockAuthUser = { id: 'user-1', email: 'test@test.com', name: 'Test User' }
vi.mock('@garden/app-state/auth', () => ({
  useAuthStore: Object.assign(
    (selector?: MockSelector) => {
      const state = { user: mockAuthUser, isAuthenticated: true }
      return selector ? selector(state) : state
    },
    { getState: () => ({ user: mockAuthUser, isAuthenticated: true }) },
  ),
}))

// Mock @garden/app-state/workspace
vi.mock('@garden/app-state/workspace', () => ({
  useWorkspaceStore: Object.assign(
    (selector?: MockSelector) => {
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

// Mock @/lib/workspace/hooks
vi.mock('@/lib/workspace/hooks', () => ({
  useActorName: () => ({
    getMemberName: (id: string) => (id === 'user-1' ? 'Test User' : 'Unknown'),
    getAgentName: (id: string) =>
      id === 'agent-1' ? 'Garden Agent' : 'Unknown Agent',
    getActorName: (type: string, id: string) => {
      if (type === 'member' && id === 'user-1') return 'Test User'
      if (type === 'agent' && id === 'agent-1') return 'Garden Agent'
      return 'Unknown'
    },
    getActorInitials: (type: string) => (type === 'member' ? 'TU' : 'GA'),
    getActorAvatarUrl: () => null,
  }),
}))

// Mock workspace queries
vi.mock('@/lib/workspace/queries', () => ({
  memberListOptions: () => ({
    queryKey: ['workspaces', 'ws-1', 'members'],
    queryFn: () =>
      Promise.resolve([
        {
          user_id: 'user-1',
          name: 'Test User',
          email: 'test@test.com',
          role: 'admin',
        },
      ]),
  }),
  agentListOptions: () => ({
    queryKey: ['workspaces', 'ws-1', 'agents'],
    queryFn: () => Promise.resolve([]),
  }),
  assigneeFrequencyOptions: () => ({
    queryKey: ['workspaces', 'ws-1', 'assignee-frequency'],
    queryFn: () => Promise.resolve([]),
  }),
}))

const navigationSearch = vi.hoisted(() => ({ value: '' }))

// Mock navigation
vi.mock('../../navigation', () => ({
  AppLink: ({ children, href, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useNavigation: () => ({
    push: vi.fn(),
    pathname: '/issues/issue-1',
    searchParams: new URLSearchParams(navigationSearch.value),
    getShareableUrl: undefined,
  }),
  useNavigationActions: () => ({ push: vi.fn() }),
  NavigationProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const editorUploads = vi.hoisted(() => ({ active: false }))

// Mock editor components (Tiptap requires real DOM)
vi.mock('../../editor', () => ({
  useFileDropZone: () => ({ isDragOver: false, dropZoneProps: {} }),
  FileDropOverlay: () => null,
  ReadonlyContent: ({ content }: { content: string }) => (
    <div data-testid="readonly-content">{content}</div>
  ),
  ContentEditor: forwardRef<MockContentEditorHandle, MockEditorProps>(
    function MockContentEditor({ defaultValue, onUpdate, placeholder }, ref) {
      const valueRef = useRef(defaultValue || '')
      const [value, setValue] = useState(defaultValue || '')
      useImperativeHandle(ref, () => ({
        getMarkdown: () => valueRef.current,
        clearContent: () => {
          valueRef.current = ''
          setValue('')
        },
        focus: () => {},
        uploadFile: () => {},
        hasActiveUploads: () => editorUploads.active,
      }))
      return (
        <textarea
          value={value}
          onChange={(e) => {
            valueRef.current = e.target.value
            setValue(e.target.value)
            onUpdate?.(e.target.value)
          }}
          placeholder={placeholder}
          data-testid="rich-text-editor"
        />
      )
    },
  ),
}))

// Mock common components
vi.mock('../../common/actor-avatar', () => ({
  ActorAvatar: ({
    actorType,
    actorId,
  }: {
    actorType: string
    actorId: string
  }) => (
    <span data-testid="actor-avatar">
      {actorType}:{actorId}
    </span>
  ),
}))

vi.mock('../../projects/components/project-picker', () => ({
  ProjectPicker: () => <span data-testid="project-picker">Project</span>,
}))

// Mock api
const mockApiObj = vi.hoisted(() => ({
  getIssue: vi.fn(),
  listTimeline: vi.fn().mockResolvedValue([]),
  listComments: vi.fn().mockResolvedValue([]),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  deleteIssue: vi.fn(),
  updateIssue: vi.fn(),
  listIssueSubscribers: vi.fn().mockResolvedValue([]),
  subscribeToIssue: vi.fn().mockResolvedValue(undefined),
  unsubscribeFromIssue: vi.fn().mockResolvedValue(undefined),
  getActiveRun: vi.fn().mockResolvedValue({
    run: null,
    work_products: [],
    events: [],
  }),
  getIssuePendingApproval: vi.fn().mockResolvedValue({ approval: null }),
  getRunEvents: vi.fn().mockResolvedValue([]),
  listIssueWorkProducts: vi.fn().mockResolvedValue([]),
  getChildIssueProgress: vi.fn().mockResolvedValue({ progress: [] }),
  listChildIssues: vi.fn().mockResolvedValue({ issues: [] }),
  listIssues: vi.fn().mockResolvedValue({ issues: [], total: 0 }),
  uploadFile: vi.fn(),
  listIssueReactions: vi.fn().mockResolvedValue([]),
  addIssueReaction: vi.fn(),
  removeIssueReaction: vi.fn(),
  addCommentReaction: vi.fn(),
  removeCommentReaction: vi.fn(),
  listMembers: vi.fn().mockResolvedValue([
    {
      user_id: 'user-1',
      name: 'Test User',
      email: 'test@test.com',
      role: 'admin',
    },
  ]),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/api', () => ({
  api: mockApiObj,
  getApi: () => mockApiObj,
}))

// Mock recent issues store
const mockRecordVisit = vi.fn()
vi.mock('@garden/app-state/issues/stores/recent-issues-store', () => ({
  useRecentIssuesStore: Object.assign(
    (selector?: MockSelector) => {
      const state = { items: [], recordVisit: mockRecordVisit }
      return selector ? selector(state) : state
    },
    { getState: () => ({ items: [], recordVisit: mockRecordVisit }) },
  ),
}))

// Mock core/format: pin relative times, keep the other formatters real.
vi.mock('@garden/core/format', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  timeAgo: () => '1d ago',
}))

// Mock core/hooks/use-file-upload
vi.mock('@garden/app-state/hooks/use-file-upload', () => ({
  useFileUpload: () => ({
    uploadWithToast: vi.fn().mockResolvedValue('https://example.com/file.png'),
  }),
}))

// Mock sonner
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

// Each picker renders one button per title that picks a fixed issue.
vi.mock('./issue-picker-dialog', () => ({
  IssuePickerDialog: ({
    title,
    onSelect,
  }: {
    title: string
    onSelect: (issue: { id: string; identifier: string }) => void
  }) => (
    <button
      type="button"
      onClick={() => onSelect({ id: 'issue-9', identifier: 'GAR-9' })}
    >
      pick for {title}
    </button>
  ),
}))

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockIssue: Issue = {
  id: 'issue-1',
  workspace_id: 'ws-1',
  team_id: null,
  number: 1,
  identifier: 'TES-1',
  title: 'Implement authentication',
  description: 'Add JWT auth to the backend',
  status: 'in_progress',
  priority: 'high',
  assignee_type: 'member',
  assignee_id: 'user-1',
  creator_type: 'member',
  creator_id: 'user-1',
  parent_issue_id: null,
  project_id: null,
  position: 'a0',
  due_date: '2026-06-01T00:00:00Z',
  created_at: '2026-01-15T00:00:00Z',
  updated_at: '2026-01-20T00:00:00Z',
}

const mockTimeline: TimelineEntry[] = [
  {
    type: 'comment',
    id: 'comment-1',
    actor_type: 'member',
    actor_id: 'user-1',
    content: 'Started working on this',
    parent_id: null,
    created_at: '2026-01-16T00:00:00Z',
    updated_at: '2026-01-16T00:00:00Z',
    comment_type: 'comment',
  },
  {
    type: 'comment',
    id: 'comment-2',
    actor_type: 'agent',
    actor_id: 'agent-1',
    content: 'I can help with this',
    parent_id: null,
    created_at: '2026-01-17T00:00:00Z',
    updated_at: '2026-01-17T00:00:00Z',
    comment_type: 'comment',
  },
]

// ---------------------------------------------------------------------------
// Import component under test (after mocks)
// ---------------------------------------------------------------------------

import { toast } from 'sonner'
import { ApiError } from '@/lib/api/errors'
import { issueKeys } from '@/lib/issues/queries'
import { IssueDetail } from './issue-detail'

const notFound = () =>
  new ApiError({ message: 'Not found', status: 404, statusText: 'Not Found' })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

/** The comment composer's (mocked) editor, as opposed to the description. */
function commentBox() {
  const box = screen
    .getAllByTestId('rich-text-editor')
    .find((el) => el.getAttribute('placeholder') !== 'Add description...')
  if (!box) throw new Error('comment box not rendered')
  return box
}

async function findCommentBox() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Comments' }))
  await screen.findByRole('button', { name: 'Submit comment' })
  return commentBox()
}

function renderIssueDetail(
  issueId = 'issue-1',
  seed?: (queryClient: QueryClient) => void,
) {
  const queryClient = createTestQueryClient()
  seed?.(queryClient)
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <IssueDetail issueId={issueId} />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IssueDetail (shared)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationSearch.value = ''
    // Default: issue loads successfully
    mockApiObj.getIssue.mockResolvedValue(mockIssue)
    mockApiObj.listTimeline.mockResolvedValue(mockTimeline)
    mockApiObj.listIssueReactions.mockResolvedValue([])
    mockApiObj.listIssueSubscribers.mockResolvedValue([])
    mockApiObj.listChildIssues.mockResolvedValue({ issues: [] })
    mockApiObj.listIssues.mockResolvedValue({ issues: [], total: 0 })
    mockApiObj.getActiveRun.mockResolvedValue({
      run: null,
      work_products: [],
      events: [],
    })
    mockApiObj.getIssuePendingApproval.mockResolvedValue({ approval: null })
    mockApiObj.getRunEvents.mockResolvedValue([])
    mockApiObj.listMembers.mockResolvedValue([
      {
        user_id: 'user-1',
        name: 'Test User',
        email: 'test@test.com',
        role: 'admin',
      },
    ])
    mockApiObj.listAgents.mockResolvedValue([])
  })

  it('shows loading skeleton while data is loading', () => {
    // Make the API hang to keep loading state
    mockApiObj.getIssue.mockReturnValue(new Promise(() => {}))
    renderIssueDetail()

    expect(document.querySelector('[data-boneyard-bone="true"]')).not.toBeNull()
  })

  it('renders issue title and description after loading', async () => {
    renderIssueDetail()

    await waitFor(() => {
      expect(
        screen.getByDisplayValue('Implement authentication'),
      ).toBeInTheDocument()
    })

    expect(
      screen.getByDisplayValue('Add JWT auth to the backend'),
    ).toBeInTheDocument()
  })

  it('saves a wrapping title on blur and uses Enter to finish editing', async () => {
    mockApiObj.updateIssue.mockResolvedValue({
      ...mockIssue,
      title: 'A long task title that remains editable on a narrow screen',
    })
    renderIssueDetail()
    const title = await screen.findByRole('textbox', { name: 'Issue title' })
    expect(title.tagName).toBe('TEXTAREA')
    fireEvent.change(title, {
      target: {
        value: 'A long task title that remains editable on a narrow screen',
      },
    })
    title.focus()
    fireEvent.keyDown(title, { key: 'Enter' })
    await waitFor(() =>
      expect(mockApiObj.updateIssue).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({
          title: 'A long task title that remains editable on a narrow screen',
        }),
      ),
    )
    expect(title).not.toHaveFocus()
  })

  it('discards the title draft on Escape and permits a later save', async () => {
    renderIssueDetail()
    const title = await screen.findByRole('textbox', { name: 'Issue title' })
    title.focus()
    fireEvent.change(title, { target: { value: 'Discard this title' } })
    fireEvent.keyDown(title, { key: 'Escape' })
    expect(title).not.toHaveFocus()
    expect(title).toHaveValue(mockIssue.title)
    expect(mockApiObj.updateIssue).not.toHaveBeenCalled()
    title.focus()
    fireEvent.change(title, { target: { value: 'Keep this title' } })
    fireEvent.keyDown(title, { key: 'Enter' })
    await waitFor(() =>
      expect(mockApiObj.updateIssue).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ title: 'Keep this title' }),
      ),
    )
  })

  it('keeps the comment draft when the task is assigned to an agent', async () => {
    const { queryClient } = renderIssueDetail()
    const composer = await findCommentBox()
    fireEvent.change(composer, {
      target: { value: 'A draft for the new assignee' },
    })
    await act(async () => {
      queryClient.setQueryData(issueKeys.detail('ws-1', 'issue-1'), {
        ...mockIssue,
        assignee_type: 'agent',
        assignee_id: 'agent-1',
      })
    })
    await screen.findByPlaceholderText(/Redirect Garden/)
    expect(commentBox()).toBe(composer)
    expect(commentBox()).toHaveValue('A draft for the new assignee')
  })

  it('keeps editing the title when Enter confirms IME composition', async () => {
    renderIssueDetail()
    const title = await screen.findByRole('textbox', { name: 'Issue title' })
    title.focus()
    fireEvent.change(title, { target: { value: '認証を実装' } })
    fireEvent.keyDown(title, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(title, { key: 'Enter', keyCode: 229 })
    expect(title).toHaveFocus()
    expect(mockApiObj.updateIssue).not.toHaveBeenCalled()

    fireEvent.keyDown(title, { key: 'Enter' })
    expect(title).not.toHaveFocus()
    await waitFor(() =>
      expect(mockApiObj.updateIssue).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ title: '認証を実装' }),
      ),
    )
  })

  it('shows a title changed elsewhere and does not overwrite it on blur', async () => {
    const { queryClient } = renderIssueDetail()
    const title = await screen.findByRole('textbox', { name: 'Issue title' })
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    fireEvent.focus(title)
    // React Query notifies observers on a later tick; flush it inside act.
    await act(async () => {
      queryClient.setQueryData(issueKeys.detail('ws-1', 'issue-1'), {
        ...mockIssue,
        title: 'Renamed by someone else',
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(title).toHaveValue('Renamed by someone else')
    fireEvent.blur(title)
    expect(mockApiObj.updateIssue).not.toHaveBeenCalled()
  })

  it('keeps the title draft while editing when the title changes elsewhere', async () => {
    const { queryClient } = renderIssueDetail()
    const title = await screen.findByRole('textbox', { name: 'Issue title' })
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    fireEvent.focus(title)
    fireEvent.change(title, { target: { value: 'My draft title' } })
    // React Query notifies observers on a later tick; flush it inside act.
    await act(async () => {
      queryClient.setQueryData(issueKeys.detail('ws-1', 'issue-1'), {
        ...mockIssue,
        title: 'Renamed by someone else',
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(title).toHaveValue('My draft title')
    fireEvent.blur(title)
    await waitFor(() =>
      expect(mockApiObj.updateIssue).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ title: 'My draft title' }),
      ),
    )
  })

  it('opens and closes task properties in a mobile sheet', async () => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const media = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation((query) => ({
        ...mediaQuery,
        media: query,
        matches: query === '(max-width: 767px)',
      }))
    renderIssueDetail()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Toggle properties' }),
    )
    const sheet = await screen.findByRole('dialog', { name: 'Task properties' })
    expect(sheet).toBeVisible()
    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Task properties' }),
      ).toBeNull(),
    )
    media.mockRestore()
  })

  it('fetches the issue even when the list already has a copy of it', async () => {
    mockApiObj.getIssue.mockResolvedValue({ ...mockIssue, status: 'blocked' })
    renderIssueDetail('issue-1', (queryClient) => {
      // As in the app, where queries default to staleTime: Infinity.
      queryClient.setDefaultOptions({
        queries: {
          ...queryClient.getDefaultOptions().queries,
          staleTime: Infinity,
        },
      })
      queryClient.setQueryData(issueKeys.list('ws-1'), {
        issues: [{ ...mockIssue, status: 'todo' }],
        total: 1,
        doneTotal: 0,
      })
    })

    // The list's copy shows first; the detail request still runs and wins.
    await waitFor(() => expect(mockApiObj.getIssue).toHaveBeenCalled())
    expect((await screen.findAllByText('Blocked')).length).toBeGreaterThan(0)
  })

  it('fetches the issue once, reactions included', async () => {
    mockApiObj.getIssue.mockResolvedValue({
      ...mockIssue,
      reactions: [
        {
          id: 'r1',
          issue_id: 'issue-1',
          actor_type: 'member',
          actor_id: 'user-2',
          emoji: '🎉',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    })
    renderIssueDetail()

    expect(
      await screen.findByDisplayValue('Implement authentication'),
    ).toBeInTheDocument()
    expect(await screen.findByText('🎉')).toBeInTheDocument()
    expect(mockApiObj.getIssue).toHaveBeenCalledTimes(1)
  })

  it('records a visit once per issue, not on every update', async () => {
    mockApiObj.updateIssue.mockResolvedValue({
      ...mockIssue,
      description: 'Changed',
    })
    renderIssueDetail()

    const description = await screen.findByDisplayValue(
      'Add JWT auth to the backend',
    )
    expect(mockRecordVisit).toHaveBeenCalledTimes(1)
    fireEvent.change(description, { target: { value: 'Changed' } })
    await waitFor(() => expect(mockApiObj.updateIssue).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByDisplayValue('Changed')).toBeTruthy(),
    )

    expect(mockRecordVisit).toHaveBeenCalledTimes(1)
  })

  it('saves an emptied description instead of dropping the field', async () => {
    mockApiObj.updateIssue.mockResolvedValue({ ...mockIssue, description: '' })
    renderIssueDetail()

    const description = await screen.findByDisplayValue(
      'Add JWT auth to the backend',
    )
    fireEvent.change(description, { target: { value: '' } })

    await waitFor(() =>
      expect(mockApiObj.updateIssue).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ description: '' }),
      ),
    )
  })

  it('keeps the comment text when sending it fails', async () => {
    mockApiObj.createComment.mockRejectedValue(new Error('network down'))
    renderIssueDetail()

    const box = await findCommentBox()
    fireEvent.change(box, { target: { value: 'Ship it on Friday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit comment' }))

    await waitFor(() => expect(mockApiObj.createComment).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Submit comment' }),
      ).toBeInTheDocument(),
    )
    expect(commentBox()).toHaveValue('Ship it on Friday')
  })

  it('does not send a comment while an attachment is still uploading', async () => {
    editorUploads.active = true
    renderIssueDetail()

    const box = await findCommentBox()
    fireEvent.change(box, { target: { value: 'See screenshot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit comment' }))

    expect(mockApiObj.createComment).not.toHaveBeenCalled()
    expect(commentBox()).toHaveValue('See screenshot')
    editorUploads.active = false
  })

  it('clears the comment box once the comment is sent', async () => {
    mockApiObj.createComment.mockResolvedValue({
      id: 'comment-new',
      content: 'Ship it on Friday',
    })
    renderIssueDetail()

    const box = await findCommentBox()
    fireEvent.change(box, { target: { value: 'Ship it on Friday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit comment' }))

    await waitFor(() => expect(commentBox()).toHaveValue(''))
  })

  it('renders issue identifier in the breadcrumb', async () => {
    renderIssueDetail()

    await waitFor(() => {
      expect(screen.getByText('TES-1')).toBeInTheDocument()
    })
  })

  it('renders Tasks as breadcrumb link', async () => {
    renderIssueDetail()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument()
  })

  it('renders properties sidebar with status, priority, assignee, due date', async () => {
    renderIssueDetail()

    await waitFor(() => {
      expect(screen.getByText('Properties')).toBeInTheDocument()
    })

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Priority')).toBeInTheDocument()
    expect(screen.getByText('Assignee')).toBeInTheDocument()
    expect(screen.getByText('Due date')).toBeInTheDocument()
  })

  it('renders Details section with Created by and dates', async () => {
    renderIssueDetail()

    await waitFor(() => {
      expect(screen.getByText('Details')).toBeInTheDocument()
    })

    expect(screen.getByText('Created by')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
  })

  it("shows 'not found' message when issue does not exist", async () => {
    mockApiObj.getIssue.mockRejectedValue(notFound())

    renderIssueDetail('nonexistent-id')

    await waitFor(() => {
      expect(
        screen.getByText(
          'This issue does not exist or has been deleted in this workspace.',
        ),
      ).toBeInTheDocument()
    })
  })

  it('offers a retry instead of "deleted" when loading the issue fails', async () => {
    mockApiObj.getIssue
      .mockRejectedValueOnce(
        new ApiError({ message: 'Server error', status: 500, statusText: '' }),
      )
      .mockResolvedValue(mockIssue)

    renderIssueDetail('issue-1')

    expect(
      await screen.findByText('Could not load this issue.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        'This issue does not exist or has been deleted in this workspace.',
      ),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.queryByText('Could not load this issue.')).toBeNull(),
    )
    expect(await screen.findByDisplayValue(mockIssue.title)).toBeInTheDocument()
  })

  it("shows 'Back to Issues' button when issue is not found and no onDelete prop", async () => {
    mockApiObj.getIssue.mockRejectedValue(notFound())

    renderIssueDetail('nonexistent-id')

    await waitFor(() => {
      expect(screen.getByText('Back to Issues')).toBeInTheDocument()
    })
  })

  it('takes the collapsed properties sidebar out of the tab order', async () => {
    renderIssueDetail()
    const toggle = await screen.findByRole('button', {
      name: 'Toggle properties',
    })
    const sidebar = screen.getByTestId('issue-detail-sidebar')
    const wasOpen = toggle.getAttribute('aria-expanded') === 'true'
    expect(sidebar.hasAttribute('inert')).toBe(!wasOpen)

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', String(!wasOpen))
    expect(sidebar.hasAttribute('inert')).toBe(wasOpen)
  })

  it('renders Activity section header', async () => {
    renderIssueDetail()

    await waitFor(() => {
      expect(screen.getAllByText('Activity').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders comments from timeline', async () => {
    renderIssueDetail()
    fireEvent.click(await screen.findByRole('tab', { name: 'Comments' }))

    await waitFor(() => {
      expect(screen.getByText('Started working on this')).toBeInTheDocument()
    })

    expect(screen.getByText('I can help with this')).toBeInTheDocument()
  })

  it('says the activity failed to load, and loads it on retry', async () => {
    mockApiObj.listTimeline.mockRejectedValueOnce(new Error('offline'))
    renderIssueDetail()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load activity.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByRole('button', { name: /replied/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Could not load activity.')).toBeNull()
  })

  it('keeps collapse and expand available in the comment menu', async () => {
    renderIssueDetail()
    fireEvent.click(await screen.findByRole('tab', { name: 'Comments' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Comment actions' }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Collapse thread' }),
    )
    expect(screen.queryByTestId('readonly-content')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Comment actions' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Expand thread' }),
    )
    expect(screen.getByTestId('readonly-content')).toHaveTextContent(
      'Started working on this',
    )
    expect(screen.getByRole('button', { name: 'Reply' })).toBeVisible()
  })

  it('expands a collapsed thread when editing its comment', async () => {
    renderIssueDetail()
    fireEvent.click(await screen.findByRole('tab', { name: 'Comments' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Comment actions' }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Collapse thread' }),
    )
    expect(screen.queryByTestId('readonly-content')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Comment actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    expect(await screen.findByPlaceholderText('Edit comment...')).toBeVisible()
  })

  it('opens Comments for a focused comment link', async () => {
    navigationSearch.value = 'focus=comment:comment-1'
    const scroll = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    renderIssueDetail()
    expect(
      await screen.findByRole('tab', { name: 'Comments' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Started working on this')).toBeVisible()
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    scroll.mockRestore()
  })

  it('splits system activity and comments across tabs', async () => {
    mockApiObj.listTimeline.mockResolvedValue([
      ...mockTimeline,
      {
        type: 'activity',
        id: 'activity-1',
        actor_type: 'member',
        actor_id: 'user-1',
        action: 'created',
        created_at: '2026-01-15T00:00:00Z',
      },
    ])
    renderIssueDetail()
    expect(await screen.findByText('created this issue')).toBeVisible()
    expect(screen.getByText('Started working on this')).not.toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }))
    expect(screen.getByRole('heading', { name: 'Comments (2)' })).toBeVisible()
    expect(screen.queryByText('created this issue')).toBeNull()
    expect(screen.getByText('Started working on this')).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(screen.getByText('created this issue')).toBeVisible()
  })

  it('links each agent reply from Activity and keeps it in Comments', async () => {
    const scroll = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    renderIssueDetail()
    const row = await screen.findByRole('button', { name: /replied/ })
    expect(screen.getAllByRole('button', { name: /replied/ })).toHaveLength(1)
    expect(screen.getByText('I can help with this')).not.toBeVisible()
    fireEvent.click(row)
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('I can help with this')).toBeVisible()
    expect(scroll).toHaveBeenCalled()
    scroll.mockRestore()
  })

  it('retains a comment draft across tab switches', async () => {
    renderIssueDetail()
    fireEvent.change(await findCommentBox(), {
      target: { value: 'Draft to keep' },
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }))
    expect(commentBox()).toHaveValue('Draft to keep')
    expect(mockApiObj.createComment).not.toHaveBeenCalled()
    expect(
      screen.queryByText(
        'Sending starts a fresh turn with this as the trigger.',
      ),
    ).toBeNull()
  })

  it('keeps an unfinished comment edit across tab switches and saves it', async () => {
    mockApiObj.updateComment.mockResolvedValue({
      ...mockTimeline[0],
      content: 'Edited after switching tabs',
    })
    renderIssueDetail()
    fireEvent.click(await screen.findByRole('tab', { name: 'Comments' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Comment actions' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    fireEvent.change(await screen.findByPlaceholderText('Edit comment...'), {
      target: { value: 'Edited after switching tabs' },
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }))

    expect(screen.getByPlaceholderText('Edit comment...')).toHaveValue(
      'Edited after switching tabs',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockApiObj.updateComment).toHaveBeenCalledWith(
        'comment-1',
        'Edited after switching tabs',
      ),
    )
  })

  it('shows task-specific empty states without sample automation content', async () => {
    mockApiObj.listTimeline.mockResolvedValue([])
    renderIssueDetail()
    expect(await screen.findByText('No activity yet')).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }))
    expect(screen.getByText('No comments yet')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Comments (0)' })).toBeVisible()
  })

  it('updates task status from the inline badge', async () => {
    mockApiObj.updateIssue.mockResolvedValue({ ...mockIssue, status: 'done' })
    renderIssueDetail()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Status: In Progress' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(mockApiObj.updateIssue).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ status: 'done' }),
      ),
    )
  })

  it('disables approval actions when the preview has no request id', async () => {
    mockApiObj.getActiveRun.mockResolvedValue({
      run: {
        id: 'run-1',
        workspace_id: 'ws-1',
        issue_id: 'issue-1',
        agent_id: 'agent-1',
        host_name: 'garden',
        status: 'waiting_for_approval',
        trigger_source: 'manual',
        trigger_ref: null,
        parent_run_id: null,
        workflow_instance_id: null,
        cancel_requested_at: null,
        context_snapshot: null,
        result_json: null,
        usage_json: null,
        usage: null,
        failure: null,
        blocked_reason: null,
        started_at: '2026-01-20T00:00:00Z',
        finished_at: null,
        created_at: '2026-01-20T00:00:00Z',
        updated_at: '2026-01-20T00:00:00Z',
      },
      work_products: [],
      events: [
        {
          id: 'event-1',
          workspace_id: 'ws-1',
          issue_id: 'issue-1',
          run_id: 'run-1',
          seq: 1,
          event_type: 'issue_run:approval_requested',
          stream: 'system',
          level: 'info',
          message: null,
          payload: { title: 'Garden wants to comment', body: 'Comment body' },
          created_at: '2026-01-20T00:00:00Z',
        },
      ],
    })

    renderIssueDetail()

    const approve = await screen.findByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
  })
})

describe('IssueDetail parent and sub-issue pickers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationSearch.value = ''
    mockApiObj.getIssue.mockResolvedValue(mockIssue)
    mockApiObj.listTimeline.mockResolvedValue(mockTimeline)
    mockApiObj.listIssueReactions.mockResolvedValue([])
    mockApiObj.listIssueSubscribers.mockResolvedValue([])
  })

  it.each([
    ['Set parent issue', 'Set GAR-9 as parent issue'],
    ['Add sub-issue', 'Added GAR-9 as sub-issue'],
  ])('%s says it worked only once it did', async (title, message) => {
    let finish: () => void = () => {}
    mockApiObj.updateIssue.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(mockIssue)
        }),
    )
    renderIssueDetail()

    fireEvent.click(
      await screen.findByRole('button', { name: `pick for ${title}` }),
    )
    await waitFor(() => expect(mockApiObj.updateIssue).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()

    finish()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(message))
  })

  it('does not report success when setting the parent fails', async () => {
    mockApiObj.updateIssue.mockRejectedValue(new Error('offline'))
    renderIssueDetail()

    fireEvent.click(
      await screen.findByRole('button', { name: 'pick for Set parent issue' }),
    )

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to set parent issue'),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })
})
