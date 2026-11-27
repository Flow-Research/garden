import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationPreferenceView } from '@garden/db/schema/notification-preferences'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { NotificationPreferencesSection } from './notification-preferences-section'

const api = vi.hoisted(() => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreference: vi.fn(),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

const ALL_ON: NotificationPreferenceView = [
  { category: 'mentions', channels: { email: true } },
  { category: 'assignments', channels: { email: true } },
  { category: 'approvals', channels: { email: true } },
  { category: 'input_requests', channels: { email: true } },
]

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <NotificationPreferencesSection />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('NotificationPreferencesSection', () => {
  beforeEach(() => {
    api.getNotificationPreferences.mockReset()
    api.updateNotificationPreference.mockReset()
    toastError.mockReset()
    api.getNotificationPreferences.mockResolvedValue({ preferences: ALL_ON })
    useWorkspaceStore.setState({
      workspace: {
        id: 'ws-1',
        name: 'Garden',
        slug: 'garden',
        description: null,
        context: null,
        settings: {},
        issue_prefix: 'GAR',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    })
  })

  it('names and describes four email switches that start on', async () => {
    renderSection()
    expect(
      screen.getByRole('heading', { name: 'Email notifications' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/events in Garden send you email/)).toBeTruthy()
    const names = ['Mentions', 'Assignments', 'Approvals', 'Input requests']
    for (const name of names) {
      const toggle = await screen.findByRole('switch', { name })
      expect(toggle).toHaveAttribute('aria-checked', 'true')
      expect(toggle).toHaveAccessibleDescription()
    }
    expect(screen.getAllByRole('switch')).toHaveLength(4)
    expect(api.getNotificationPreferences).toHaveBeenCalledWith('ws-1')
  })

  it('saves one toggle for the active workspace and shows it at once', async () => {
    let resolve: (value: {
      preferences: NotificationPreferenceView
    }) => void = () => {}
    api.updateNotificationPreference.mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    renderSection()
    const toggle = await screen.findByRole('switch', { name: 'Approvals' })
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
    expect(api.updateNotificationPreference).toHaveBeenCalledWith('ws-1', {
      category: 'approvals',
      channel: 'email',
      enabled: false,
    })
    const saved = ALL_ON.map((row) =>
      row.category === 'approvals'
        ? { ...row, channels: { email: false } }
        : row,
    )
    api.getNotificationPreferences.mockResolvedValue({ preferences: saved })
    resolve({ preferences: saved })
    await waitFor(() =>
      expect(api.getNotificationPreferences).toHaveBeenCalledTimes(2),
    )
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('reverts the toggle and reports the failure when saving fails', async () => {
    api.updateNotificationPreference.mockRejectedValue(new Error('offline'))
    renderSection()
    const toggle = await screen.findByRole('switch', { name: 'Mentions' })
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Could not save mentions email setting',
      ),
    )
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
  })

  it('offers a retry when the settings cannot load', async () => {
    api.getNotificationPreferences.mockRejectedValueOnce(new Error('offline'))
    renderSection()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load your notification settings.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('switch', { name: 'Mentions' }),
    ).toBeInTheDocument()
  })
})
