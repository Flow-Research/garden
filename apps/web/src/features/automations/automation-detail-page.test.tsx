import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import type {
  Automation,
  AutomationDetailResponse,
  AutomationTrigger,
} from '@/lib/api'
import { workspaceKeys } from '@/lib/workspace/queries'
import { AutomationDetailPage } from './automation-detail-page'
import { automationKeys } from './queries'

const mocks = vi.hoisted(() => ({
  deleteAutomation: vi.fn(),
  deleteAutomationTrigger: vi.fn(),
}))

vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api: {
    getAutomation: vi.fn(),
    listAutomationRuns: vi.fn(async () => []),
    listAgents: vi.fn(async () => []),
    deleteAutomation: mocks.deleteAutomation,
    deleteAutomationTrigger: mocks.deleteAutomationTrigger,
  },
}))
vi.mock('@/lib/workspace/hooks', () => ({
  useActorName: () => ({
    getActorName: () => 'Ada',
    getActorInitials: () => 'A',
    getActorAvatarUrl: () => null,
  }),
}))

const WS_ID = 'ws-1'

const AUTOMATION = {
  id: 'auto-1',
  workspace_id: WS_ID,
  project_id: null,
  title: 'Nightly triage',
  description: null,
  assignee_agent_id: 'agent-1',
  priority: 'medium',
  status: 'active',
  concurrency_policy: 'skip',
  last_run_at: null,
  created_by: 'user-1',
  created_at: null,
  updated_at: null,
  system_prompt: null,
  input_schema: null,
  context_sources: null,
  output_config: null,
  execution_config: null,
  notification_config: null,
  scheduling_config: null,
  tags: [],
  category: null,
  template_source: null,
  next_run_at: null,
  run_count: 0,
  success_count: 0,
  failure_count: 0,
  skip_count: 0,
  avg_duration_ms: null,
  updated_by: null,
  metadata: null,
} satisfies Automation

const TRIGGER = {
  id: 'trigger-1',
  automation_id: 'auto-1',
  kind: 'schedule',
  enabled: true,
  label: null,
  cron_expression: '0 9 * * *',
  timezone: 'UTC',
  next_run_at: null,
  last_fired_at: null,
  created_at: null,
  updated_at: null,
} satisfies AutomationTrigger

let queryClient: QueryClient

function renderPage(onDeleted = vi.fn()) {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  const detail: AutomationDetailResponse = {
    automation: AUTOMATION,
    triggers: [TRIGGER],
    runs: [],
  }
  queryClient.setQueryData(automationKeys.detail(WS_ID, 'auto-1'), detail)
  queryClient.setQueryData(automationKeys.runs(WS_ID, 'auto-1', false), [])
  queryClient.setQueryData(workspaceKeys.agents(WS_ID), [])
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId={WS_ID}>
        <AutomationDetailPage automationId="auto-1" onDeleted={onDeleted} />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
  return onDeleted
}

describe('AutomationDetailPage deletes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks before deleting the automation', async () => {
    mocks.deleteAutomation.mockResolvedValue(undefined)
    const onDeleted = renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete automation' }),
    )
    expect(mocks.deleteAutomation).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent === 'Delete automation',
      ) ?? dialog,
    )

    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(mocks.deleteAutomation).toHaveBeenCalledTimes(1)
  })

  it('asks before deleting a trigger and does nothing on cancel', async () => {
    renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete trigger' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(mocks.deleteAutomationTrigger).not.toHaveBeenCalled()
  })

  it('keeps edits when the automation refetches while the dialog is open', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }))
    const name = await screen.findByDisplayValue('Nightly triage')
    fireEvent.change(name, { target: { value: 'Nightly triage v2' } })

    act(() => {
      queryClient.setQueryData(automationKeys.detail(WS_ID, 'auto-1'), {
        automation: { ...AUTOMATION, status: 'paused' },
        triggers: [TRIGGER],
        runs: [],
      } satisfies AutomationDetailResponse)
    })

    // Wait for the refetched automation to reach the page before checking.
    await screen.findByText('paused')
    expect(screen.getByDisplayValue('Nightly triage v2')).toBeTruthy()
  })
})
