import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Skill } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useSkillsBrowseStore } from '@garden/app-state/skills'
import SkillsPage from './skills-page'

const mocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  getSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    listSkills: mocks.listSkills,
    getSkill: mocks.getSkill,
    updateSkill: mocks.updateSkill,
    deleteSkill: mocks.deleteSkill,
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

/** The file editor; the skills filter is the other textbox on the page. */
function editorBox() {
  const [box] = screen
    .getAllByRole('textbox')
    .filter((el) => el.getAttribute('aria-label') !== 'Filter skills')
  if (!box) throw new Error('no editor textbox')
  return box
}

function renderPage(props: Parameters<typeof SkillsPage>[0] = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId={WS_ID}>
        <SkillsPage {...props} />
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
    fireEvent.change(editorBox(), {
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

describe('SkillsPage library', () => {
  const second = skill({ id: 'skill-2', name: 'Triage', content: '# Triage' })

  beforeEach(() => {
    vi.clearAllMocks()
    useSkillsBrowseStore.getState().reset()
    mocks.listSkills.mockResolvedValue([skill({}), second])
    mocks.getSkill.mockImplementation(async (id: string) =>
      id === 'skill-2'
        ? second
        : skill({ files: [skillFile('scripts/run.sh', 'echo hi')] }),
    )
  })

  function skillsList() {
    return within(screen.getByRole('navigation', { name: 'Skills' }))
  }

  it('lists every skill, opens the one clicked and puts it in the URL', async () => {
    const onSelectSkill = vi.fn()
    renderPage({ onSelectSkill })

    await screen.findByRole('navigation', { name: 'Skills' })
    expect(skillsList().getByText('2 skills')).toBeInTheDocument()
    fireEvent.click(skillsList().getByRole('button', { name: 'Triage' }))

    expect(onSelectSkill).toHaveBeenCalledWith('skill-2')
    expect(
      await screen.findByRole('heading', { name: 'Triage' }),
    ).toBeInTheDocument()
  })

  it('opens the skill named in the URL', async () => {
    renderPage({ focusedSkillId: 'skill-2' })
    expect(
      await screen.findByRole('heading', { name: 'Triage' }),
    ).toBeInTheDocument()
  })

  it('can add a skill when the library is not empty', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add skill' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it("shows the skill's files and opens one", async () => {
    renderPage()
    const files = within(
      await screen.findByRole('navigation', { name: 'Skill files' }),
    )
    fireEvent.click(await files.findByText('run.sh'))
    expect(
      await screen.findByText('scripts/run.sh', { selector: 'header span' }),
    ).toBeInTheDocument()
  })

  it('asks before switching away from unsaved edits', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(editorBox(), {
      target: { value: 'Draft notes' },
    })

    fireEvent.click(skillsList().getByRole('button', { name: 'Triage' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Keep editing' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(editorBox()).toHaveValue('Draft notes')

    fireEvent.click(skillsList().getByRole('button', { name: 'Triage' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Discard changes',
      }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Triage' }),
    ).toBeInTheDocument()
  })
})

describe('SkillsPage delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSkillsBrowseStore.getState().reset()
    mocks.listSkills.mockResolvedValue([skill({})])
    mocks.getSkill.mockResolvedValue(skill({}))
  })

  it('keeps the confirmation open when deleting fails', async () => {
    mocks.deleteSkill.mockRejectedValue(new Error('Skill is in use'))
    renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Skill actions' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Delete skill' }),
    )

    await waitFor(() => expect(mocks.deleteSkill).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        within(confirm).getByRole('button', { name: 'Delete skill' }),
      ).not.toBeDisabled(),
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
