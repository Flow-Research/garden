import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Skill } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import SkillsPage from './skills-page'

const mocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  getSkill: vi.fn(),
  updateSkill: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    listSkills: mocks.listSkills,
    getSkill: mocks.getSkill,
    updateSkill: mocks.updateSkill,
  },
}))
vi.mock('../../common/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}))

const WS_ID = 'ws-test'

function skill(overrides: Partial<Skill>): Skill {
  return {
    id: 'skill-1',
    name: 'Release notes',
    content: '# Release notes',
    files: [],
    bundle_hash: 'hash-1',
    ...overrides,
  } as Skill
}

function skillFile(path: string, content: string): Skill['files'][number] {
  return {
    id: `file-${path}`,
    skill_id: 'skill-1',
    path,
    content,
    content_hash: null,
    r2_key: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId={WS_ID}>
        <SkillsPage />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('SkillsPage editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The list endpoint carries no supporting files; the full skill does.
    mocks.listSkills.mockResolvedValue([skill({})])
    mocks.getSkill.mockResolvedValue(
      skill({ files: [skillFile('scripts/run.sh', 'echo hi')] }),
    )
    mocks.updateSkill.mockImplementation(
      async (_id: string, data: { content: string }) =>
        skill({
          content: data.content,
          bundle_hash: 'hash-2',
          files: [skillFile('scripts/run.sh', 'echo hi')],
        }),
    )
  })

  it('opens a skill with supporting files without marking it unsaved', async () => {
    renderPage()

    await screen.findByRole('button', { name: 'Edit' })
    await waitFor(() => expect(mocks.getSkill).toHaveBeenCalled())
    expect(screen.queryByText('Unsaved')).toBeNull()
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('keeps supporting files when SKILL.md is edited and saved', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '# Release notes\n\nUpdated' },
    })
    fireEvent.click(await screen.findByRole('button', { name: /save/i }))

    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(1))
    const [, data] = mocks.updateSkill.mock.calls[0] ?? []
    expect(data).toEqual({ content: '# Release notes\n\nUpdated' })
    expect(data).not.toHaveProperty('files')
  })
})

describe('SkillsPage list states', () => {
  it('says the skills failed to load instead of showing an empty library', async () => {
    vi.clearAllMocks()
    mocks.listSkills
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([skill({})])
    mocks.getSkill.mockResolvedValue(skill({}))
    renderPage()

    expect(
      await screen.findByText('Could not load skills.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      (await screen.findAllByText('Release notes')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Could not load skills.')).toBeNull()
  })
})
