import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { ApiError } from '@/lib/api'
import { HOST_REPORT_WINDOW_MS } from '../status'
import {
  HOST_ID,
  LAUNCH_ID,
  NOW,
  OTHER_WORKSPACE_ID,
  WORKSPACE_ID,
  hostDirectory,
  hostEvent,
  hostSnapshot,
  hostSummary,
} from '../test-fixtures'
import { ExecutionHostsPage } from './execution-hosts-page'

const api = vi.hoisted(() => ({
  listExecutionHosts: vi.fn(),
  getExecutionHostRun: vi.fn(),
}))
vi.mock('../api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  ...api,
}))

const refusal = (message: string, status: number) =>
  new ApiError({ message, status, statusText: '' })

const onOpenRun = vi.fn()

function renderPage(launchId?: string, workspaceId = WORKSPACE_ID) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId={workspaceId}>
        <ExecutionHostsPage launchId={launchId} onOpenRun={onOpenRun} />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

function nth<T>(items: T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`Expected an item at ${index}`)
  return item
}

const synchronized = <T,>(value: T) => ({ ...value, receivedAt: NOW })

describe('ExecutionHostsPage host list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listExecutionHosts.mockResolvedValue(
      synchronized(hostDirectory([hostSummary()])),
    )
  })

  it('lists the hosts that the server returns for the current workspace only', async () => {
    api.listExecutionHosts.mockImplementation(async (workspaceId: string) =>
      synchronized(
        workspaceId === WORKSPACE_ID
          ? hostDirectory([hostSummary()])
          : hostDirectory(
              [
                hostSummary({
                  hostId: '99999999-9999-4999-8999-999999999999',
                  workspaceId: OTHER_WORKSPACE_ID,
                }),
              ],
              { workspaceId: OTHER_WORKSPACE_ID },
            ),
      ),
    )
    renderPage()
    expect(await screen.findByText(HOST_ID)).toBeVisible()
    expect(api.listExecutionHosts).toHaveBeenCalledTimes(1)
    expect(api.listExecutionHosts.mock.calls[0]?.[0]).toBe(WORKSPACE_ID)
    expect(screen.queryByText(/^99999999/)).toBeNull()
    expect(screen.getByText('Reported recently')).toBeVisible()
    expect(screen.getByText('garden, workstream')).toBeVisible()
    expect(screen.getByText('Key generation').nextSibling).toHaveTextContent(
      '3',
    )
    expect(
      screen.getByText('Last synchronized', { exact: false }),
    ).toBeVisible()
  })

  it('offers no control that starts, cancels or approves host work', async () => {
    api.getExecutionHostRun.mockResolvedValue(
      synchronized(hostSnapshot([hostEvent(1)])),
    )
    renderPage(LAUNCH_ID)
    expect(await screen.findByTestId('run-state')).toBeVisible()
    expect(
      screen.getAllByRole('button').map((button) => button.textContent),
    ).toEqual(['Refresh', 'Show run', 'Refresh'])
  })

  it('shows a stale, a revoked and a never-reported host as such', async () => {
    api.listExecutionHosts.mockResolvedValue(
      synchronized(
        hostDirectory([
          hostSummary({ lastSeenAt: NOW - HOST_REPORT_WINDOW_MS - 1 }),
          hostSummary({
            hostId: '88888888-8888-4888-8888-888888888888',
            lastSeenAt: null,
          }),
          hostSummary({
            hostId: '99999999-9999-4999-8999-999999999999',
            status: 'revoked',
          }),
        ]),
      ),
    )
    renderPage()
    const rows = await screen.findAllByRole('listitem')
    expect(within(nth(rows, 0)).getByText('Stale')).toBeVisible()
    expect(within(nth(rows, 1)).getByText('Never reported')).toBeVisible()
    expect(within(nth(rows, 1)).getByText('Never')).toBeVisible()
    expect(within(nth(rows, 2)).getAllByText('Revoked')).toHaveLength(2)
    expect(screen.queryByText('Reported recently')).toBeNull()
  })

  it('shows the empty state when no host is enrolled', async () => {
    api.listExecutionHosts.mockResolvedValue(synchronized(hostDirectory([])))
    renderPage()
    expect(await screen.findByText('No host is enrolled')).toBeVisible()
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('shows the disabled state when the pilot is not configured', async () => {
    api.listExecutionHosts.mockRejectedValue(
      refusal('The engineering pilot is not configured', 503),
    )
    renderPage(LAUNCH_ID)
    expect(
      await screen.findByText('Execution hosts are disabled'),
    ).toBeVisible()
    expect(api.listExecutionHosts).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Launch ID')).toBeNull()
    expect(api.getExecutionHostRun).not.toHaveBeenCalled()
  })

  it('shows the refusal of the server guard to a signed-out user and to a non-member', async () => {
    api.listExecutionHosts.mockRejectedValue(refusal('Unauthorized', 401))
    renderPage()
    expect(await screen.findByText('Sign in again')).toBeVisible()
    expect(screen.queryByText(HOST_ID)).toBeNull()

    api.listExecutionHosts.mockRejectedValue(
      refusal('This operator is outside the pilot', 403),
    )
    renderPage(undefined, OTHER_WORKSPACE_ID)
    expect(
      await screen.findByText('You cannot view execution hosts'),
    ).toBeVisible()
    expect(screen.queryByText(HOST_ID)).toBeNull()
    expect(screen.queryByLabelText('Launch ID')).toBeNull()
  })

  it('reports an outage as a failed load, not as an empty list', async () => {
    api.listExecutionHosts.mockRejectedValue(
      refusal('The database is unavailable. Try again shortly.', 503),
    )
    renderPage()
    expect(
      await screen.findByText('Could not load execution hosts.'),
    ).toBeVisible()
    expect(api.listExecutionHosts).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('No host is enrolled')).toBeNull()
  })

  it('removes host data when a later refresh is refused', async () => {
    renderPage()
    expect(await screen.findByText(HOST_ID)).toBeVisible()
    api.listExecutionHosts.mockRejectedValue(
      refusal('This operator is outside the pilot', 403),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(
      await screen.findByText('You cannot view execution hosts'),
    ).toBeVisible()
    expect(screen.queryByText(HOST_ID)).toBeNull()
  })
})

describe('ExecutionHostsPage run status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listExecutionHosts.mockResolvedValue(
      synchronized(hostDirectory([hostSummary()])),
    )
  })

  it('opens a run only for a launch ID in UUID format', async () => {
    renderPage()
    const field = await screen.findByLabelText('Launch ID')
    fireEvent.change(field, { target: { value: 'not-a-launch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show run' }))
    expect(screen.getByText('Enter a launch ID in UUID format.')).toBeVisible()
    expect(onOpenRun).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: ` ${LAUNCH_ID} ` } })
    fireEvent.click(screen.getByRole('button', { name: 'Show run' }))
    expect(onOpenRun).toHaveBeenCalledWith(LAUNCH_ID)
    expect(api.getExecutionHostRun).not.toHaveBeenCalled()
  })

  it('shows the reported state and the ordered events of a run', async () => {
    api.getExecutionHostRun.mockResolvedValue(
      synchronized(
        hostSnapshot([
          hostEvent(1, { state: 'reserved', reason: 'reserved' }),
          hostEvent(2),
        ]),
      ),
    )
    renderPage(LAUNCH_ID)
    expect(await screen.findByTestId('run-state')).toHaveTextContent('Running')
    expect(api.getExecutionHostRun.mock.calls[0]?.slice(0, 3)).toEqual([
      WORKSPACE_ID,
      LAUNCH_ID,
      0,
    ])
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((row) => row.firstChild?.textContent)).toEqual(['1', '2'])
    expect(within(nth(rows, 0)).getByText('reserved')).toBeVisible()
    expect(screen.getByText('Showing 2 of 2 events.')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Load more events' }),
    ).toBeNull()
  })

  it('never shows running for a host that has not reported recently', async () => {
    api.getExecutionHostRun.mockResolvedValue(
      synchronized(
        hostSnapshot([hostEvent(1)], {
          host: hostSummary({ lastSeenAt: NOW - HOST_REPORT_WINDOW_MS - 1 }),
        }),
      ),
    )
    renderPage(LAUNCH_ID)
    expect(await screen.findByTestId('run-state')).toHaveTextContent('Stale')
    expect(screen.getByText('Last reported state: Running')).toBeVisible()
  })

  it('shows unknown, not running, when the refresh of a run fails', async () => {
    api.getExecutionHostRun.mockResolvedValue(
      synchronized(hostSnapshot([hostEvent(1)])),
    )
    renderPage(LAUNCH_ID)
    expect(await screen.findByTestId('run-state')).toHaveTextContent('Running')
    api.getExecutionHostRun.mockRejectedValue(new Error('offline'))
    fireEvent.click(nth(screen.getAllByRole('button', { name: 'Refresh' }), 1))
    expect(
      await screen.findByText(
        'The last refresh failed. This data can be out of date.',
      ),
    ).toBeVisible()
    expect(screen.getByTestId('run-state')).toHaveTextContent('Unknown')
  })

  it('separates a cancellation request from confirmed termination', async () => {
    api.getExecutionHostRun.mockResolvedValue(
      synchronized(hostSnapshot([hostEvent(1)], { cancellation: 'requested' })),
    )
    renderPage(LAUNCH_ID)
    expect(await screen.findByTestId('run-state')).toHaveTextContent(
      'Cancellation requested',
    )
    expect(
      screen.getByText(
        'Termination is not confirmed. The host has not reported that the process stopped.',
      ),
    ).toBeVisible()
    expect(screen.getByText('Termination').nextSibling).toHaveTextContent(
      'Not confirmed',
    )
    expect(screen.queryByText('Termination confirmed by the host.')).toBeNull()
  })

  it('shows confirmed termination after the host reports the cancelled process', async () => {
    api.getExecutionHostRun.mockResolvedValue(
      synchronized(
        hostSnapshot(
          [
            hostEvent(1),
            hostEvent(2, {
              state: 'cancelled',
              reason: 'termination_confirmed',
              evidenceDigest: 'f'.repeat(64),
            }),
          ],
          { cancellation: 'requested', termination: 'host-confirmed' },
        ),
      ),
    )
    renderPage(LAUNCH_ID)
    expect(await screen.findByTestId('run-state')).toHaveTextContent(
      'Cancelled',
    )
    expect(screen.getByText('Termination confirmed by the host.')).toBeVisible()
    expect(screen.getByText('Termination').nextSibling).toHaveTextContent(
      'Confirmed by host',
    )
    expect(screen.getByText('ffffffffffff')).toBeVisible()
  })

  it('loads the next event page with the cursor that the snapshot returned', async () => {
    const first = Array.from({ length: 200 }, (_, index) =>
      hostEvent(index + 1),
    )
    const last = hostEvent(201, {
      state: 'verifying',
      reason: 'verifying',
    })
    api.getExecutionHostRun.mockImplementation(
      async (_workspaceId: string, _launchId: string, after: number) =>
        synchronized(
          after === 0
            ? hostSnapshot(first, { lastSequence: 201, latestEvent: last })
            : hostSnapshot([last], { lastSequence: 201 }),
        ),
    )
    renderPage(LAUNCH_ID)
    expect(await screen.findByText('Showing 200 of 201 events.')).toBeVisible()
    expect(screen.getByTestId('run-state')).toHaveTextContent('Verifying')
    fireEvent.click(screen.getByRole('button', { name: 'Load more events' }))
    expect(await screen.findByText('Showing 201 of 201 events.')).toBeVisible()
    expect(api.getExecutionHostRun.mock.calls.map((call) => call[2])).toEqual([
      0, 200,
    ])
    expect(screen.getAllByRole('row')).toHaveLength(202)
    expect(
      screen.queryByRole('button', { name: 'Load more events' }),
    ).toBeNull()
  })

  it('reports a launch that the workspace does not hold', async () => {
    api.getExecutionHostRun.mockRejectedValue(refusal('Launch not found', 404))
    renderPage(LAUNCH_ID)
    expect(await screen.findByText('Run not found')).toBeVisible()
    expect(api.getExecutionHostRun).toHaveBeenCalledTimes(1)
  })
})
