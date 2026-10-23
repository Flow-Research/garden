import {
  forwardRef,
  useRef,
  useState,
  useImperativeHandle,
  type ComponentProps,
} from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Issue, TimelineEntry } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import type {
  MockContentEditorHandle,
  MockEditorProps,
  MockSelector,
  MockTitleEditorHandle,
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
    searchParams: new URLSearchParams(),
    getShareableUrl: undefined,
  }),
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
  TitleEditor: forwardRef<MockTitleEditorHandle, MockEditorProps>(
    function MockTitleEditor(
      { defaultValue, placeholder, onBlur, onChange },
      ref,
    ) {
      const valueRef = useRef(defaultValue || '')
      const [value, setValue] = useState(defaultValue || '')
      useImperativeHandle(ref, () => ({
        getText: () => valueRef.current,
        focus: () => {},
      }))
      return (
        <input
          value={value}
          onChange={(e) => {
            valueRef.current = e.target.value
            setValue(e.target.value)
            onChange?.(e.target.value)
          }}
          onBlur={() => onBlur?.(valueRef.current)}
          placeholder={placeholder}
          data-testid="title-editor"
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
    urgent: {
      label: 'Urgent',
      bars: 4,
      color: 'text-destructive',
      badgeBg: 'bg-destructive/10',
      badgeText: 'text-destructive',
    },
    high: {
      label: 'High',
      bars: 3,
      color: 'text-warning',
      badgeBg: 'bg-warning/10',
      badgeText: 'text-warning',
    },
    medium: {
      label: 'Medium',
      bars: 2,
      color: 'text-warning',
      badgeBg: 'bg-warning/10',
      badgeText: 'text-warning',
    },
    low: {
      label: 'Low',
      bars: 1,
      color: 'text-info',
      badgeBg: 'bg-info/10',
      badgeText: 'text-info',
    },
    none: {
      label: 'No priority',
      bars: 0,
      color: 'text-muted-foreground',
      badgeBg: 'bg-muted',
      badgeText: 'text-muted-foreground',
    },
  },
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
  toast: { error: vi.fn(), success: vi.fn() },
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
  position: 0,
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
  await screen.findByRole('button', { name: 'Submit comment' })
  return commentBox()
}

function renderIssueDetail(issueId = 'issue-1') {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <IssueDetail issueId={issueId} />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IssueDetail (shared)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('renders workspace name as breadcrumb link', async () => {
    renderIssueDetail()

    await waitFor(() => {
      expect(screen.getByText('Test WS')).toBeInTheDocument()
    })

    expect(screen.getByText('Test WS')).toBeInTheDocument()
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
      await screen.findByText('Started working on this'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Could not load activity.')).toBeNull()
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
        error: null,
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
