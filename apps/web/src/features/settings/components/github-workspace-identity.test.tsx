import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  GithubWorkspaceIdentitySection,
  githubIdentityStatusLabel,
} from './github-workspace-identity'

const mockUpdateMember = vi.hoisted(() => vi.fn())
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())
const mockUseAuthStore = vi.hoisted(() => vi.fn())
const mockUseWorkspaceStore = vi.hoisted(() => vi.fn())
const mockUseWorkspaceId = vi.hoisted(() => vi.fn())
const mockUseQuery = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  api: {
    updateMember: mockUpdateMember,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

vi.mock('@garden/app-state/auth', () => ({
  useAuthStore: mockUseAuthStore,
}))

vi.mock('@garden/app-state/workspace', () => ({
  useWorkspaceStore: mockUseWorkspaceStore,
}))

vi.mock('@garden/app-state/hooks', () => ({
  useWorkspaceId: mockUseWorkspaceId,
}))

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query',
  )
  return {
    ...actual,
    useQuery: mockUseQuery,
  }
})

vi.mock('./resolve-github-login', () => ({
  normalizeGithubLogin: (raw: string) => raw.trim().replace(/^@+/, ''),
  resolveGithubLogin: vi.fn(async (login: string) => {
    const { Result } = await import('better-result')
    if (!login.trim()) {
      return Result.err({ message: 'Enter a GitHub username' })
    }
    return Result.ok({ user_id: '583231', login: login.replace(/^@/, '') })
  }),
  searchGithubUsers: vi.fn(async () => {
    const { Result } = await import('better-result')
    return Result.ok([
      {
        user_id: '583231',
        login: 'octocat',
        avatar_url: null,
      },
    ])
  }),
}))

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <GithubWorkspaceIdentitySection />
    </QueryClientProvider>,
  )
}

describe('githubIdentityStatusLabel', () => {
  it('formats linked and not-linked states', () => {
    expect(githubIdentityStatusLabel({ github_login: 'octocat' })).toBe(
      '@octocat',
    )
    expect(githubIdentityStatusLabel({ github_login: null })).toBe(
      'GitHub not linked',
    )
  })
})

describe('GithubWorkspaceIdentitySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuthStore.mockImplementation(
      (selector: (state: { user: { id: string } }) => unknown) =>
        selector({ user: { id: 'user-1' } }),
    )
    mockUseWorkspaceStore.mockImplementation(
      (selector: (state: { workspace: { id: string; name: string } }) => unknown) =>
        selector({ workspace: { id: 'ws-1', name: 'Garden' } }),
    )
    mockUseWorkspaceId.mockReturnValue('ws-1')
    mockUseQuery.mockImplementation(
      (options: { queryKey?: readonly unknown[] }) => {
        if (options.queryKey?.[0] === 'github-user-search') {
          return {
            data: [
              {
                user_id: '583231',
                login: 'octocat',
                avatar_url: null,
              },
            ],
            isPending: false,
            isFetching: false,
            isError: false,
            error: null,
          }
        }
        return {
          data: [
            {
              id: 'mem-1',
              workspace_id: 'ws-1',
              user_id: 'user-1',
              role: 'member',
              github_user_id: null,
              github_login: null,
              created_at: '2026-01-01T00:00:00.000Z',
              name: 'Ada',
              email: 'ada@example.com',
              avatar_url: null,
            },
          ],
          isPending: false,
        }
      },
    )
    mockUpdateMember.mockResolvedValue({})
  })

  it('shows not linked and links after picking a suggestion', async () => {
    const user = userEvent.setup()
    renderSection()

    expect(screen.getByText('Not linked')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /link github/i }))
    expect(
      screen.getByRole('heading', { name: /link github/i }),
    ).toBeInTheDocument()

    await user.type(screen.getByLabelText(/github username/i), 'octo')
    await waitFor(
      () => {
        expect(
          screen.getByRole('option', { name: /@octocat/i }),
        ).toBeInTheDocument()
      },
      { timeout: 2000 },
    )
    await user.click(screen.getByRole('option', { name: /@octocat/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() =>
      expect(mockUpdateMember).toHaveBeenCalledWith('ws-1', 'mem-1', {
        github_user_id: '583231',
        github_login: 'octocat',
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalled()
  })
})
