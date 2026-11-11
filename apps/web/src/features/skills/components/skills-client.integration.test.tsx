import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from '@/lib/api/state'
import { listSkills } from '@/lib/api/skills'
import SkillsPage from './skills-page'

vi.mock('@/lib/api', () => ({ api: { listSkills } }))
vi.mock('@/lib/auth/client', () => ({
  authClient: { organization: { setActive: vi.fn() } },
}))
vi.mock('../../common/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}))

const skill = {
  id: 'skill-1',
  workspace_id: 'workspace-a',
  slug: 'review',
  name: 'Review code',
  description: 'Check a change',
  content: '# Review',
  config: { name: 'Review code', description: 'Check a change' },
  files: [],
  source_type: 'manual',
  source_url: null,
  bundle_hash: null,
  created_by: null,
  created_at: '2026-11-11',
  updated_at: '2026-11-11',
}

function renderSkills() {
  const transport = configureApi('https://garden.test')
  transport.setWorkspaceId('workspace-a')
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="workspace-a">
        <SkillsPage onSelectSkill={vi.fn()} />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('skills UI through the real shared client adapter', () => {
  it('renders a typed catalog response through the web consumer', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json([skill]))
    const queryClient = renderSkills()
    expect(
      await screen.findByRole('heading', { name: 'Review code' }),
    ).toBeVisible()
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get('x-workspace-id'),
    ).toBe('workspace-a')
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe('include')
    queryClient.clear()
  })

  it('shows a recoverable error when the server denies the catalog read', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { _tag: 'SkillForbiddenError', message: 'Not permitted' },
        { status: 403 },
      ),
    )
    const queryClient = renderSkills()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load skills.',
    )
    expect(screen.getByRole('button', { name: /try again/i })).toBeVisible()
    expect(screen.queryByText('Review code')).toBeNull()
    queryClient.clear()
  })
})
