import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Skill, UpdateSkillRequest } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useSkillsBrowseStore } from '@garden/app-state/skills'
import SkillsPage from './skills-page'

const mocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  getSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  createSkill: vi.fn(),
  importSkill: vi.fn(),
  previewSkill: vi.fn(),
  searchSkills: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    listSkills: mocks.listSkills,
    getSkill: mocks.getSkill,
    updateSkill: mocks.updateSkill,
    deleteSkill: mocks.deleteSkill,
    createSkill: mocks.createSkill,
    importSkill: mocks.importSkill,
    previewSkill: mocks.previewSkill,
    searchSkills: mocks.searchSkills,
  },
}))
vi.mock('../../common/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}))

const WS_ID = 'ws-test'

function skill(overrides: Partial<Skill>): Skill {
  return {
    id: 'skill-1',
    workspace_id: WS_ID,
    slug: 'release-notes',
    name: 'Release notes',
    description: 'Write a release summary',
    content: '# Release notes',
    config: { name: 'Release notes', description: 'Write a release summary' },
    files: [],
    source_type: 'manual',
    source_url: null,
    created_by: null,
    created_at: '2026-11-14T00:00:00.000Z',
    updated_at: '2026-11-14T00:00:00.000Z',
    bundle_hash: 'hash-1',
    ...overrides,
  }
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
      async (_id: string, data: UpdateSkillRequest) =>
        skill({
          content: data.content ?? '# Release notes',
          bundle_hash: 'hash-2',
          files: data.files?.map((file) =>
            skillFile(file.path, file.content),
          ) ?? [skillFile('scripts/run.sh', 'echo hi')],
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
    fireEvent.keyDown(editorBox(), { key: 's', ctrlKey: true })

    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(1))
    const [, data] = mocks.updateSkill.mock.calls[0] ?? []
    expect(data).toEqual({ content: '# Release notes\n\nUpdated' })
    expect(data).not.toHaveProperty('files')
  })

  it('keeps a failed save editable and retries the same draft with keyboard save', async () => {
    mocks.updateSkill.mockRejectedValueOnce(new Error('Write failed'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(editorBox(), { target: { value: 'Draft notes' } })
    fireEvent.keyDown(editorBox(), { key: 's', ctrlKey: true })
    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(1))
    expect(editorBox()).toHaveValue('Draft notes')
    expect(await screen.findByText('Unsaved')).toBeInTheDocument()
    await waitFor(() => expect(editorBox()).not.toHaveAttribute('readonly'))
    fireEvent.keyDown(editorBox(), { key: 's', ctrlKey: true })
    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Unsaved')).toBeNull())
  })

  it('saves an edited supporting file with the rest of the bundle intact', async () => {
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: 'scripts/run.sh' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Edit scripts/run.sh' }),
      { target: { value: 'echo updated' } },
    )
    fireEvent.keyDown(editorBox(), { key: 's', metaKey: true })
    await waitFor(() =>
      expect(mocks.updateSkill).toHaveBeenCalledWith('skill-1', {
        files: [{ path: 'scripts/run.sh', content: 'echo updated' }],
      }),
    )
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
  const second = skill({
    id: 'skill-2',
    name: 'Triage',
    description: 'Review incoming issues',
    content: '# Triage',
  })

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
    fireEvent.click(
      await files.findByRole('button', { name: 'scripts/run.sh' }),
    )
    expect(
      await screen.findByLabelText('Source of scripts/run.sh'),
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

  it('keeps a new draft guarded when an earlier skill save finishes after navigation', async () => {
    let finishSave: ((value: Skill) => void) | undefined
    mocks.updateSkill.mockImplementationOnce(
      () =>
        new Promise<Skill>((resolve) => {
          finishSave = resolve
        }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(editorBox(), { target: { value: 'First draft' } })
    fireEvent.keyDown(editorBox(), { key: 's', ctrlKey: true })
    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(1))
    fireEvent.click(skillsList().getByRole('button', { name: 'Triage' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Discard changes',
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(editorBox(), { target: { value: 'Triage draft' } })
    finishSave?.(skill({ content: 'First draft', bundle_hash: 'saved-first' }))
    await waitFor(() => expect(mocks.listSkills).toHaveBeenCalledTimes(2))
    expect(editorBox()).toHaveValue('Triage draft')
    fireEvent.click(skillsList().getByRole('button', { name: 'Release notes' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })

  it('preserves a reopened skill draft when its previous editor finishes saving', async () => {
    let finishSave: ((value: Skill) => void) | undefined
    mocks.updateSkill.mockImplementationOnce(
      () =>
        new Promise<Skill>((resolve) => {
          finishSave = resolve
        }),
    )
    mocks.updateSkill.mockResolvedValueOnce(
      skill({
        content: 'Reopened draft',
        bundle_hash: 'saved-reopened',
        files: [skillFile('scripts/run.sh', 'echo hi')],
      }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(editorBox(), { target: { value: 'First draft' } })
    fireEvent.keyDown(editorBox(), { key: 's', ctrlKey: true })
    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(1))
    fireEvent.click(skillsList().getByRole('button', { name: 'Triage' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Discard changes',
      }),
    )
    await screen.findByRole('heading', { name: 'Triage' })
    fireEvent.click(skillsList().getByRole('button', { name: 'Release notes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(editorBox(), { target: { value: 'Reopened draft' } })

    await act(async () => {
      finishSave?.(
        skill({
          content: 'First draft',
          bundle_hash: 'saved-first',
          files: [skillFile('scripts/run.sh', 'echo hi')],
        }),
      )
    })
    await waitFor(() => expect(mocks.listSkills).toHaveBeenCalledTimes(2))
    expect(editorBox()).toHaveValue('Reopened draft')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    fireEvent.click(skillsList().getByRole('button', { name: 'Triage' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Keep editing',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    fireEvent.keyDown(editorBox(), { key: 's', ctrlKey: true })
    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(2))
    expect(mocks.updateSkill).toHaveBeenLastCalledWith('skill-1', {
      content: 'Reopened draft',
    })
    await waitFor(() => expect(screen.queryByText('Unsaved')).toBeNull())
    expect(editorBox()).toHaveValue('Reopened draft')
  })

  it.each(['succeeds', 'fails'])(
    'queues a reopened skill save until its previous save %s',
    async (outcome) => {
      let finishFirst: ((value: Skill) => void) | undefined
      let failFirst: ((reason: Error) => void) | undefined
      let finishSecond: ((value: Skill) => void) | undefined
      mocks.updateSkill
        .mockImplementationOnce(
          () =>
            new Promise<Skill>((resolve, reject) => {
              finishFirst = resolve
              failFirst = reject
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<Skill>((resolve) => {
              finishSecond = resolve
            }),
        )
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
      fireEvent.change(editorBox(), { target: { value: 'First draft' } })
      fireEvent.keyDown(editorBox(), { key: 's', ctrlKey: true })
      await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(1))
      fireEvent.click(skillsList().getByRole('button', { name: 'Triage' }))
      fireEvent.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'Discard changes',
        }),
      )
      await screen.findByRole('heading', { name: 'Triage' })
      fireEvent.click(
        skillsList().getByRole('button', { name: 'Release notes' }),
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
      fireEvent.change(editorBox(), { target: { value: 'Reopened draft' } })
      await act(async () => {
        fireEvent.keyDown(editorBox(), { key: 's', ctrlKey: true })
      })

      for (const button of screen.getAllByRole('button', { name: 'Saving' })) {
        expect(button).toBeDisabled()
      }
      expect(mocks.updateSkill).toHaveBeenCalledTimes(1)
      await act(async () => {
        if (outcome === 'succeeds') {
          finishFirst?.(
            skill({ content: 'First draft', bundle_hash: 'saved-first' }),
          )
        } else {
          failFirst?.(new Error('Write failed'))
        }
      })
      await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(2))
      expect(mocks.updateSkill).toHaveBeenLastCalledWith('skill-1', {
        content: 'Reopened draft',
      })
      expect(editorBox()).toHaveValue('Reopened draft')
      expect(screen.getByText('Unsaved')).toBeInTheDocument()
      await act(async () => {
        finishSecond?.(
          skill({ content: 'Reopened draft', bundle_hash: 'saved-reopened' }),
        )
      })
      await waitFor(() => expect(screen.queryByText('Unsaved')).toBeNull())
      expect(editorBox()).toHaveValue('Reopened draft')
    },
  )

  it('saves another skill while the previous skill still has a pending save', async () => {
    let finishFirst: ((value: Skill) => void) | undefined
    let finishSecond: ((value: Skill) => void) | undefined
    mocks.updateSkill
      .mockImplementationOnce(
        () =>
          new Promise<Skill>((resolve) => {
            finishFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Skill>((resolve) => {
            finishSecond = resolve
          }),
      )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(editorBox(), { target: { value: 'First draft' } })
    fireEvent.keyDown(editorBox(), { key: 's', ctrlKey: true })
    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(1))
    fireEvent.click(skillsList().getByRole('button', { name: 'Triage' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Discard changes',
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(editorBox(), { target: { value: 'Triage draft' } })
    fireEvent.keyDown(editorBox(), { key: 's', ctrlKey: true })
    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(2))
    expect(mocks.updateSkill).toHaveBeenLastCalledWith('skill-2', {
      content: 'Triage draft',
    })
    await act(async () => {
      finishFirst?.(
        skill({ content: 'First draft', bundle_hash: 'saved-first' }),
      )
    })
    expect(editorBox()).toHaveValue('Triage draft')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    await act(async () => {
      finishSecond?.({
        ...second,
        content: 'Triage draft',
        bundle_hash: 'saved-triage',
      })
    })
    await waitFor(() => expect(screen.queryByText('Unsaved')).toBeNull())
    expect(editorBox()).toHaveValue('Triage draft')
  })

  it('opens the initially selected skill, returns to the list, and preserves search', async () => {
    const onSelectSkill = vi.fn()
    renderPage({ onSelectSkill })
    const filter = await screen.findByRole('textbox', { name: 'Filter skills' })
    fireEvent.change(filter, { target: { value: 'release' } })
    fireEvent.click(skillsList().getByRole('button', { name: 'Release notes' }))
    expect(onSelectSkill).toHaveBeenCalledWith('skill-1')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Back to skills' }),
    )
    expect(onSelectSkill).toHaveBeenLastCalledWith(undefined)
    expect(filter).toHaveValue('release')
    expect(skillsList().queryByRole('button', { name: 'Triage' })).toBeNull()
  })

  it('guards mobile back, keeps the draft on cancel, and discards it on confirmation', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit skill' }))
    fireEvent.change(editorBox(), { target: { value: 'Mobile draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back to skills' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Keep editing',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(editorBox()).toHaveValue('Mobile draft')
    fireEvent.click(screen.getByRole('button', { name: 'Back to skills' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Discard changes',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    fireEvent.click(skillsList().getByRole('button', { name: 'Release notes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit skill' }))
    expect(editorBox()).toHaveValue('# Release notes')
    expect(screen.queryByText('Unsaved')).toBeNull()
  })

  it('searches descriptions across the full library without category controls', async () => {
    mocks.listSkills.mockResolvedValue([
      skill({
        config: {
          name: 'Release notes',
          description: 'Release summary',
          metadata: { category: 'Content' },
        },
      }),
      skill({
        ...second,
        description: 'Run adversarial checks',
        config: {
          name: 'Triage',
          description: 'Run adversarial checks',
          metadata: { category: 'qa' },
        },
      }),
      skill({ id: 'uncategorized', name: 'Unsorted' }),
    ])
    renderPage()
    await screen.findByRole('navigation', { name: 'Skills' })
    expect(skillsList().queryByRole('button', { name: 'QA 1' })).toBeNull()
    expect(
      skillsList().getByRole('button', { name: 'Triage' }),
    ).toBeInTheDocument()
    fireEvent.change(
      skillsList().getByRole('textbox', { name: 'Filter skills' }),
      { target: { value: 'adversarial' } },
    )
    expect(
      skillsList().queryByRole('button', { name: 'Release notes' }),
    ).toBeNull()
    expect(
      skillsList().getByRole('button', { name: 'Triage' }),
    ).toBeInTheDocument()
    fireEvent.change(
      skillsList().getByRole('textbox', { name: 'Filter skills' }),
      { target: { value: 'unknown' } },
    )
    expect(skillsList().getByText('No matches')).toBeInTheDocument()
    fireEvent.click(skillsList().getByRole('button', { name: 'Clear filter' }))
    expect(
      skillsList().getByRole('button', { name: 'Unsorted' }),
    ).toBeInTheDocument()
    expect(
      skillsList().getByRole('button', { name: 'Release notes' }),
    ).toBeInTheDocument()
  })

  it.each([
    './SKILL.md',
    './skill.md',
    'notes.md',
    './notes.md',
    '.\\notes.md',
    './',
    'references/../notes.md',
    '/notes.md',
  ])('rejects invalid or duplicate supporting file path %s', async (path) => {
    mocks.getSkill.mockResolvedValue(
      skill({ files: [skillFile('notes.md', '# Existing notes')] }),
    )
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Skill actions' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add file' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox', { name: 'File path' }), {
      target: { value: path },
    })
    expect(dialog.getByRole('button', { name: 'Add file' })).toBeDisabled()
    fireEvent.keyDown(dialog.getByRole('textbox', { name: 'File path' }), {
      key: 'Enter',
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('Unsaved')).toBeNull()
  })

  it('adds and submits a canonical supporting file path', async () => {
    mocks.updateSkill.mockResolvedValueOnce(
      skill({
        bundle_hash: 'canonical-path',
        files: [
          skillFile('scripts/run.sh', 'echo hi'),
          skillFile('references/checks.md', '# Checks'),
        ],
      }),
    )
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Skill actions' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add file' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox', { name: 'File path' }), {
      target: { value: ' ./references//./checks.md ' },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Add file' }))
    const editor = await screen.findByRole('textbox', {
      name: 'Edit references/checks.md',
    })
    fireEvent.change(editor, { target: { value: '# Checks' } })
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true })
    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(1))
    expect(mocks.updateSkill).toHaveBeenCalledWith('skill-1', {
      files: [
        { path: 'scripts/run.sh', content: 'echo hi' },
        { path: 'references/checks.md', content: '# Checks' },
      ],
    })
    await waitFor(() => expect(screen.queryByText('Unsaved')).toBeNull())
    expect(
      screen.getByRole('textbox', { name: 'Edit references/checks.md' }),
    ).toHaveValue('# Checks')
  })

  it.each(['button', 'Enter'])(
    'blocks resource addition with %s while a dialog-started save is pending',
    async (method) => {
      let finishSave: ((value: Skill) => void) | undefined
      const pendingSave = new Promise<Skill>((resolve) => {
        finishSave = resolve
      })
      mocks.updateSkill.mockReset().mockReturnValue(pendingSave)
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
      fireEvent.change(editorBox(), { target: { value: 'Saving draft' } })
      fireEvent.click(screen.getByRole('button', { name: 'Skill actions' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Add file' }))
      const dialog = within(await screen.findByRole('dialog'))
      const input = dialog.getByRole('textbox', { name: 'File path' })
      fireEvent.change(input, {
        target: { value: 'references/during-save.md' },
      })
      fireEvent.keyDown(input, { key: 's', ctrlKey: true })
      await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(1))
      expect(mocks.updateSkill).toHaveBeenCalledWith('skill-1', {
        content: 'Saving draft',
      })
      expect(
        screen.getByRole('button', { name: 'Skill actions', hidden: true }),
      ).toBeDisabled()
      expect(dialog.getByRole('button', { name: 'Add file' })).toBeDisabled()
      if (method === 'button') {
        fireEvent.click(dialog.getByRole('button', { name: 'Add file' }))
      } else {
        fireEvent.keyDown(input, { key: 'Enter' })
      }
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'references/during-save.md',
          hidden: true,
        }),
      ).toBeNull()
      await act(async () => {
        finishSave?.(
          skill({
            content: 'Saving draft',
            bundle_hash: 'save-completed',
            files: [skillFile('scripts/run.sh', 'echo hi')],
          }),
        )
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(editorBox()).toHaveValue('Saving draft')
      expect(screen.queryByText('Unsaved')).toBeNull()
    },
  )

  it('allows resource addition again after a dialog-started save fails', async () => {
    let failSave: ((error: Error) => void) | undefined
    const pendingSave = new Promise<Skill>((_resolve, reject) => {
      failSave = reject
    })
    mocks.updateSkill.mockReset().mockReturnValue(pendingSave)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(editorBox(), { target: { value: 'Retained draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Skill actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add file' }))
    const dialog = within(await screen.findByRole('dialog'))
    const input = dialog.getByRole('textbox', { name: 'File path' })
    fireEvent.change(input, { target: { value: 'references/retry.md' } })
    fireEvent.keyDown(input, { key: 's', ctrlKey: true })
    await waitFor(() => expect(mocks.updateSkill).toHaveBeenCalledTimes(1))
    expect(dialog.getByRole('button', { name: 'Add file' })).toBeDisabled()
    await act(async () => {
      failSave?.(new Error('Save failed'))
    })
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: 'Add file' })).toBeEnabled(),
    )
    expect(input).toHaveValue('references/retry.md')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(
      await screen.findByRole('textbox', { name: 'Edit references/retry.md' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SKILL.md' }))
    expect(editorBox()).toHaveValue('Retained draft')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
  })

  it('adds a resource, edits it, and removes it without affecting the main file', async () => {
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Skill actions' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add file' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox', { name: 'File path' }), {
      target: { value: 'references/checks.md' },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Add file' }))
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Edit references/checks.md' }),
      { target: { value: '# Checks' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Skill actions' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete file' }),
    )
    expect(
      screen.queryByRole('button', { name: 'references/checks.md' }),
    ).toBeNull()
    expect(editorBox()).toHaveValue('# Release notes')
    expect(screen.queryByText('Unsaved')).toBeNull()
  })

  it('creates a skill from the library and opens its complete bundle', async () => {
    const created = skill({ id: 'created', name: 'New skill' })
    mocks.createSkill.mockImplementation(async () => {
      mocks.listSkills.mockResolvedValue([skill({}), second, created])
      return created
    })
    const onSelectSkill = vi.fn()
    renderPage({ onSelectSkill })
    fireEvent.click(await screen.findByRole('button', { name: 'Add skill' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create yours' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'New skill' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: 'A new workflow' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(mocks.createSkill).toHaveBeenCalledWith({
        name: 'New skill',
        description: 'A new workflow',
      }),
    )
    await waitFor(() => expect(onSelectSkill).toHaveBeenCalledWith('created'))
    expect(
      await screen.findByRole('heading', { name: 'New skill' }),
    ).toBeInTheDocument()
  })

  it('previews community resources and imports the selected skill', async () => {
    const url = 'example/repo/community'
    mocks.previewSkill.mockResolvedValue({
      name: 'Community',
      content: '# Community',
      files: [{ path: 'scripts/run.sh', content: 'echo community' }],
    })
    const imported = skill({
      id: 'community',
      name: 'Community',
      source_type: 'skills.sh',
      source_url: url,
    })
    mocks.importSkill.mockImplementation(async () => {
      mocks.listSkills.mockResolvedValue([skill({}), imported])
      return imported
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add skill' }))
    fireEvent.change(await screen.findByRole('combobox'), {
      target: { value: url },
    })
    fireEvent.click(
      await screen.findByRole('option', { name: /example\/repo\/community/i }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'scripts/run.sh' }),
    )
    expect(
      await screen.findByLabelText('Source of scripts/run.sh'),
    ).toHaveTextContent('echo community')
    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }))
    await waitFor(() => expect(mocks.importSkill).toHaveBeenCalledWith({ url }))
    expect(
      await screen.findByRole('heading', { name: 'Community' }),
    ).toBeInTheDocument()
  })

  it('offers source sync and preserves the confirmation when it fails', async () => {
    const imported = skill({
      source_type: 'skills.sh',
      source_url: 'https://skills.sh/example/repo/qa',
    })
    mocks.listSkills.mockResolvedValue([imported])
    mocks.getSkill.mockResolvedValue(imported)
    mocks.importSkill.mockRejectedValue(new Error('Source unavailable'))
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Skill actions' }),
    )
    expect(
      await screen.findByRole('menuitem', { name: 'Open source' }),
    ).toHaveAttribute('href', imported.source_url)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sync from source' }))
    const dialog = within(await screen.findByRole('alertdialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Sync' }))
    await waitFor(() =>
      expect(mocks.importSkill).toHaveBeenCalledWith({
        url: imported.source_url,
      }),
    )
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: 'Sync' })).not.toBeDisabled(),
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
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
