import { Suspense } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import type { TeamRepository } from '@garden/core/types'
import { TeamRepositoriesPanel } from './team-repositories-panel'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const apiMocks = vi.hoisted(() => ({
  listTeamRepositories: vi.fn(),
  listAvailableTeamRepositories: vi.fn(),
  linkTeamRepository: vi.fn(),
  unlinkTeamRepository: vi.fn(),
  retryTeamRepositoryImport: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMocks }))

function linked(overrides: Partial<TeamRepository> = {}): TeamRepository {
  return {
    id: 'link-1',
    team_id: 'team-1',
    github_repo_id: 11,
    full_name: 'Flow-Research/garden',
    import_state: 'ready',
    imported_at: '2026-11-06T10:00:00.000Z',
    linked_by: 'user-1',
    created_at: '2026-11-06T09:00:00.000Z',
    ...overrides,
  }
}

function renderPanel(canManage: boolean) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceIdProvider wsId="ws-1">
        <Suspense fallback={<p>loading</p>}>
          <TeamRepositoriesPanel canManage={canManage} teamId="team-1" />
        </Suspense>
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('TeamRepositoriesPanel', () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset()
  })

  it('links a repository picked from the installation and disables taken ones', async () => {
    apiMocks.listTeamRepositories.mockResolvedValue({ repositories: [] })
    apiMocks.listAvailableTeamRepositories.mockResolvedValue({
      repositories: [
        {
          github_repo_id: 21,
          full_name: 'Flow-Research/lms',
          private: true,
          linked_team_id: null,
        },
        {
          github_repo_id: 22,
          full_name: 'Flow-Research/workstream',
          private: false,
          linked_team_id: 'team-2',
        },
      ],
    })
    apiMocks.linkTeamRepository.mockResolvedValue(
      linked({
        id: 'link-2',
        github_repo_id: 21,
        full_name: 'Flow-Research/lms',
      }),
    )

    renderPanel(true)
    expect(
      await screen.findByText('No repositories linked yet.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Link repository' }))
    const lms = await screen.findByRole('radio', { name: /Flow-Research\/lms/ })
    const workstream = screen.getByRole('radio', {
      name: /Flow-Research\/workstream/,
    })
    expect(workstream).toBeDisabled()
    expect(screen.getByText('Linked to another Team')).toBeInTheDocument()

    fireEvent.click(lms)
    const linkButtons = screen.getAllByRole('button', {
      name: 'Link repository',
    })
    fireEvent.click(linkButtons[linkButtons.length - 1]!)

    await waitFor(() =>
      expect(apiMocks.linkTeamRepository).toHaveBeenCalledWith('team-1', {
        github_repo_id: 21,
      }),
    )
  })

  it('shows import state and offers Retry only for a failed import', async () => {
    apiMocks.listTeamRepositories.mockResolvedValue({
      repositories: [
        linked(),
        linked({
          id: 'link-3',
          github_repo_id: 31,
          full_name: 'Flow-Research/blockchain',
          import_state: 'failed',
          imported_at: null,
        }),
      ],
    })
    apiMocks.retryTeamRepositoryImport.mockResolvedValue(
      linked({ id: 'link-3', import_state: 'pending' }),
    )

    renderPanel(true)
    expect(await screen.findByText('Synced')).toBeInTheDocument()
    expect(screen.getByText('Import failed')).toBeInTheDocument()
    const retry = screen.getAllByRole('button', { name: 'Retry import' })
    expect(retry).toHaveLength(1)

    fireEvent.click(retry[0]!)
    await waitFor(() =>
      expect(apiMocks.retryTeamRepositoryImport).toHaveBeenCalledWith(
        'team-1',
        'link-3',
      ),
    )
  })

  it('is read-only for people who cannot manage the Team', async () => {
    apiMocks.listTeamRepositories.mockResolvedValue({
      repositories: [linked({ import_state: 'failed' })],
    })

    renderPanel(false)
    expect(await screen.findByText('Flow-Research/garden')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Link repository' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Unlink' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retry import' }),
    ).not.toBeInTheDocument()
  })
})
