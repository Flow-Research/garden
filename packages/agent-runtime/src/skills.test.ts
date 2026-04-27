import { describe, expect, it } from 'vitest'
import { Session } from 'agents/experimental/memory/session'
import type { SessionProvider } from 'agents/experimental/memory/session'
import {
  AssignedSkillProvider,
  BuiltinSkillCatalog,
  MergedSkillCatalog,
  buildBuiltinSkillObjectKey,
  buildBuiltinSkillManifestObjectKey,
  materializeSkillCatalog,
  type RuntimeSkillRecord,
  type SkillBundleStore,
  type SkillCatalog,
  type SkillWorkspace,
} from './skills'
import type { BuiltinSkillManifest } from './bundled-skills'

type LoadToolFn = {
  execute: (args: { label: string; key: string }) => Promise<string>
}

type UnloadToolFn = {
  execute: (args: { label: string; key: string }) => Promise<string>
}

class MutableSkillCatalog implements SkillCatalog {
  constructor(
    private readonly recordsByAgent = new Map<string, RuntimeSkillRecord[]>(),
  ) {}

  async listAssignedSkills(input: {
    agentRuntimeName: string
  }): Promise<RuntimeSkillRecord[]> {
    return this.recordsByAgent.get(input.agentRuntimeName) ?? []
  }

  async getAssignedSkill(input: {
    agentRuntimeName: string
    skillKey: string
  }): Promise<RuntimeSkillRecord[]> {
    return (this.recordsByAgent.get(input.agentRuntimeName) ?? []).filter(
      (record) => record.skillSlug === input.skillKey,
    )
  }

  replace(agentRuntimeName: string, records: RuntimeSkillRecord[]) {
    this.recordsByAgent.set(agentRuntimeName, records)
  }
}

class MemorySkillWorkspace implements SkillWorkspace {
  readonly files = new Map<string, string>()

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }
}

class MemorySkillBundleStore implements SkillBundleStore {
  constructor(private readonly files = new Map<string, string>()) {}

  async getText(key: string): Promise<string | null> {
    return this.files.get(key) ?? null
  }
}

const stubProvider: SessionProvider = {
  getMessage: () => null,
  getHistory: () => [],
  getLatestLeaf: () => null,
  getBranches: () => [],
  getPathLength: () => 0,
  appendMessage: () => {},
  updateMessage: () => {},
  deleteMessages: () => {},
  clearMessages: () => {},
  addCompaction: () => ({
    id: '',
    summary: '',
    fromMessageId: '',
    toMessageId: '',
    createdAt: '',
  }),
  getCompactions: () => [],
}

function createSkillRecord(input: {
  agentId: string
  skillId: string
  skillSlug: string
  skillName: string
  skillDescription?: string | null
  skillBody?: string | null
  skillBodyR2Key?: string | null
  bundleManifestR2Key?: string | null
  sourceUrl?: string | null
  bundleHash?: string | null
  enabled?: boolean
  filePath?: string | null
  fileContentHash?: string | null
  fileR2Key?: string | null
}): RuntimeSkillRecord {
  return {
    agentId: input.agentId as RuntimeSkillRecord['agentId'],
    skillId: input.skillId as RuntimeSkillRecord['skillId'],
    skillSlug: input.skillSlug as RuntimeSkillRecord['skillSlug'],
    skillName: input.skillName,
    skillDescription: input.skillDescription ?? null,
    skillBody: input.skillBody ?? null,
    skillBodyR2Key: input.skillBodyR2Key ?? null,
    bundleManifestR2Key: input.bundleManifestR2Key ?? null,
    sourceUrl: input.sourceUrl ?? null,
    bundleHash: input.bundleHash ?? null,
    enabled: input.enabled ?? true,
    filePath: input.filePath ?? null,
    fileContentHash: input.fileContentHash ?? null,
    fileR2Key: input.fileR2Key ?? null,
  }
}

describe('AssignedSkillProvider session integration', () => {
  it('includes hidden built-in document skills in the cached inventory', async () => {
    const workspace = new MemorySkillWorkspace()
    const agentRuntimeName = 'primary.workspace.user'
    const session = new Session(stubProvider, {
      context: [
        {
          label: 'skills',
          provider: new AssignedSkillProvider(new BuiltinSkillCatalog(), {
            agentRuntimeName,
            workspace,
            bundleStore: new MemorySkillBundleStore(),
          }),
        },
      ],
    })

    const prompt = await session.freezeSystemPrompt()

    expect(prompt).toContain('pdf')
    expect(prompt).toContain('docx')
    expect(prompt).toContain('xlsx')
    expect(prompt).toContain('pptx')
  })

  it('loads a hidden built-in skill through the same load_context path', async () => {
    const workspace = new MemorySkillWorkspace()
    const agentRuntimeName = 'primary.workspace.user'
    const bundleHash = 'builtin-hash'
    const bundleStore = new MemorySkillBundleStore(
      new Map([
        [
          buildBuiltinSkillObjectKey({
            slug: 'pdf',
            bundleHash,
            path: 'SKILL.md',
          }),
          '# pdf\nReal PDF skill body',
        ],
      ]),
    )
    const session = new Session(stubProvider, {
      context: [
        {
          label: 'skills',
          provider: new AssignedSkillProvider(
            new BuiltinSkillCatalog([
              {
                slug: 'pdf',
                name: 'pdf',
                description: 'Builtin PDF handler',
                sourceUrl: null,
                bundleHash,
              },
            ]),
            {
              agentRuntimeName,
              workspace,
              bundleStore,
            },
          ),
        },
      ],
    })

    const tools = await session.tools()
    const loadTool = tools.load_context as unknown as LoadToolFn

    const loaded = await loadTool.execute({
      label: 'skills',
      key: 'pdf',
    })

    expect(loaded).toContain('# pdf')
    expect(loaded).toContain('skill root: /.agents/skills/pdf')
    expect(workspace.files.get('/.agents/skills/pdf/SKILL.md')).toContain(
      'Real PDF skill body',
    )
  })

  it('mounts built-in supporting files from the bundle store on load_context', async () => {
    const workspace = new MemorySkillWorkspace()
    const agentRuntimeName = 'primary.workspace.user'
    const bundleHash = 'builtin-hash'
    const bundleStore = new MemorySkillBundleStore(
      new Map([
        [
          buildBuiltinSkillObjectKey({
            slug: 'pdf',
            bundleHash,
            path: 'SKILL.md',
          }),
          '# pdf\nReal PDF skill body',
        ],
        [
          buildBuiltinSkillManifestObjectKey({
            slug: 'pdf',
            bundleHash,
          }),
          JSON.stringify({ files: ['SKILL.md', 'forms.md'] }),
        ],
        [
          buildBuiltinSkillObjectKey({
            slug: 'pdf',
            bundleHash,
            path: 'forms.md',
          }),
          '# PDF Forms',
        ],
      ]),
    )

    const session = new Session(stubProvider, {
      context: [
        {
          label: 'skills',
          provider: new AssignedSkillProvider(
            new BuiltinSkillCatalog([
              {
                slug: 'pdf',
                name: 'pdf',
                description: 'Builtin PDF handler',
                sourceUrl: null,
                bundleHash,
              },
            ]),
            {
              agentRuntimeName,
              workspace,
              bundleStore,
            },
          ),
        },
      ],
    })

    const tools = await session.tools()
    const loadTool = tools.load_context as unknown as LoadToolFn

    const loaded = await loadTool.execute({
      label: 'skills',
      key: 'pdf',
    })

    expect(loaded).toContain('/.agents/skills/pdf/forms.md')
    expect(workspace.files.get('/.agents/skills/pdf/forms.md')).toBe(
      '# PDF Forms',
    )
  })

  it('renders enabled assigned skills into the cached prompt inventory once per skill', async () => {
    const catalog = new MutableSkillCatalog()
    const workspace = new MemorySkillWorkspace()
    const agentRuntimeName = 'primary.workspace.user'
    catalog.replace(agentRuntimeName, [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'code-review',
        skillName: 'Code Review',
        skillDescription: 'Review code for correctness',
        skillBody: '# Code Review\nCheck for regressions.',
        filePath: 'references/checklist.md',
      }),
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'code-review',
        skillName: 'Code Review',
        skillDescription: 'Review code for correctness',
        skillBody: '# Code Review\nCheck for regressions.',
        filePath: 'templates/report.md',
      }),
    ])

    const session = new Session(stubProvider, {
      context: [
        {
          label: 'skills',
          provider: new AssignedSkillProvider(catalog, {
            agentRuntimeName,
            workspace,
            bundleStore: new MemorySkillBundleStore(),
          }),
        },
      ],
    })

    const prompt = await session.freezeSystemPrompt()

    expect(prompt).toContain('SKILLS')
    expect(prompt).toContain('code-review')
    expect(prompt).toContain('Review code for correctness')
    expect(prompt.match(/code-review/g)).toHaveLength(1)
  })

  it('materializes bundle files into /.agents/skills/<slug> during load_context', async () => {
    const catalog = new MutableSkillCatalog()
    const workspace = new MemorySkillWorkspace()
    const bundleStore = new MemorySkillBundleStore(
      new Map([
        ['skills/ws/skill-1/hash/templates/report.md', '# Report template'],
        ['skills/ws/skill-1/hash/references/checklist.md', '# Checklist'],
      ]),
    )
    const agentRuntimeName = 'primary.workspace.user'
    catalog.replace(agentRuntimeName, [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'planning-with-files',
        skillName: 'Planning With Files',
        skillDescription: 'Plan and track multi-step work',
        skillBody: '# Planning With Files\nUse the templates.',
        sourceUrl:
          'https://skills.sh/othmanadi/planning-with-files/planning-with-files',
        bundleHash: 'hash',
        filePath: 'templates/report.md',
        fileR2Key: 'skills/ws/skill-1/hash/templates/report.md',
      }),
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'planning-with-files',
        skillName: 'Planning With Files',
        skillDescription: 'Plan and track multi-step work',
        skillBody: '# Planning With Files\nUse the templates.',
        sourceUrl:
          'https://skills.sh/othmanadi/planning-with-files/planning-with-files',
        bundleHash: 'hash',
        filePath: 'references/checklist.md',
        fileR2Key: 'skills/ws/skill-1/hash/references/checklist.md',
      }),
    ])

    const session = new Session(stubProvider, {
      context: [
        {
          label: 'skills',
          provider: new AssignedSkillProvider(catalog, {
            agentRuntimeName,
            workspace,
            bundleStore,
          }),
        },
      ],
    })

    const tools = await session.tools()
    const loadTool = tools.load_context as unknown as LoadToolFn

    const loaded = await loadTool.execute({
      label: 'skills',
      key: 'planning-with-files',
    })

    expect(loaded).toContain('skill root: /.agents/skills/planning-with-files')
    expect(loaded).toContain(
      '/.agents/skills/planning-with-files/templates/report.md',
    )
    expect(
      workspace.files.get('/.agents/skills/planning-with-files/SKILL.md'),
    ).toContain('# Planning With Files')
    expect(
      workspace.files.get(
        '/.agents/skills/planning-with-files/templates/report.md',
      ),
    ).toBe('# Report template')
    expect(
      workspace.files.get(
        '/.agents/skills/planning-with-files/references/checklist.md',
      ),
    ).toBe('# Checklist')
  })

  it('materializes all assigned skills into the workspace without load_context', async () => {
    const catalog = new MutableSkillCatalog()
    const workspace = new MemorySkillWorkspace()
    const bundleStore = new MemorySkillBundleStore(
      new Map([['skills/ws/skill-2/hash/references/brief.md', '# Brief']]),
    )
    const agentRuntimeName = 'primary.workspace.user'
    catalog.replace(agentRuntimeName, [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'code-review',
        skillName: 'Code Review',
        skillDescription: 'Review code for correctness',
        skillBody: '# Code Review\nCheck for regressions.',
      }),
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-2',
        skillSlug: 'research',
        skillName: 'Research',
        skillDescription: 'Research current context',
        skillBody: '# Research\nRead sources.',
        bundleHash: 'hash',
        filePath: 'references/brief.md',
        fileR2Key: 'skills/ws/skill-2/hash/references/brief.md',
      }),
    ])

    const materialized = await materializeSkillCatalog({
      agentRuntimeName,
      catalog,
      workspace,
      bundleStore,
    })

    expect(materialized).toEqual(['code-review', 'research'])
    expect(workspace.files.get('/.agents/skills/code-review/SKILL.md')).toBe(
      '# Code Review\nCheck for regressions.',
    )
    expect(workspace.files.get('/.agents/skills/research/SKILL.md')).toBe(
      '# Research\nRead sources.',
    )
    expect(
      workspace.files.get('/.agents/skills/research/references/brief.md'),
    ).toBe('# Brief')
  })

  it('rewrites materialized skill files when the assigned skill changes', async () => {
    const catalog = new MutableSkillCatalog()
    const workspace = new MemorySkillWorkspace()
    const bundleStore = new MemorySkillBundleStore()
    const agentRuntimeName = 'primary.workspace.user'
    catalog.replace(agentRuntimeName, [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'code-review',
        skillName: 'Code Review',
        skillBody: '# Code Review\nOriginal body.',
      }),
    ])

    await materializeSkillCatalog({
      agentRuntimeName,
      catalog,
      workspace,
      bundleStore,
    })
    catalog.replace(agentRuntimeName, [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'code-review',
        skillName: 'Code Review',
        skillBody: '# Code Review\nUpdated body.',
      }),
    ])

    await materializeSkillCatalog({
      agentRuntimeName,
      catalog,
      workspace,
      bundleStore,
    })

    expect(workspace.files.get('/.agents/skills/code-review/SKILL.md')).toBe(
      '# Code Review\nUpdated body.',
    )
  })

  it('keeps the frozen prompt stable after load_context and unload_context', async () => {
    const catalog = new MutableSkillCatalog()
    const workspace = new MemorySkillWorkspace()
    const agentRuntimeName = 'primary.workspace.user'
    catalog.replace(agentRuntimeName, [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'code-review',
        skillName: 'Code Review',
        skillDescription: 'Review code for correctness',
        skillBody: '# Code Review\nCheck for regressions.',
      }),
    ])

    const session = new Session(stubProvider, {
      context: [
        {
          label: 'skills',
          provider: new AssignedSkillProvider(catalog, {
            agentRuntimeName,
            workspace,
            bundleStore: new MemorySkillBundleStore(),
          }),
        },
      ],
    })

    const frozenBeforeLoad = await session.freezeSystemPrompt()
    const tools = await session.tools()
    const loadTool = tools.load_context as unknown as LoadToolFn
    const unloadTool = tools.unload_context as unknown as UnloadToolFn

    const loaded = await loadTool.execute({
      label: 'skills',
      key: 'code-review',
    })
    const frozenAfterLoad = await session.freezeSystemPrompt()
    const unloaded = await unloadTool.execute({
      label: 'skills',
      key: 'code-review',
    })
    const frozenAfterUnload = await session.freezeSystemPrompt()

    expect(loaded).toContain('# Code Review')
    expect(unloaded).toContain('Unloaded')
    expect(frozenAfterLoad).toBe(frozenBeforeLoad)
    expect(frozenAfterUnload).toBe(frozenBeforeLoad)
  })

  it('refreshes the same live session after assigned skills change', async () => {
    const catalog = new MutableSkillCatalog()
    const workspace = new MemorySkillWorkspace()
    const agentRuntimeName = 'primary.workspace.user'
    const bundleStore = new MemorySkillBundleStore()

    catalog.replace(agentRuntimeName, [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'code-review',
        skillName: 'Code Review',
        skillDescription: 'Review code for correctness',
        skillBody: '# Code Review\nCheck for regressions.',
      }),
    ])

    const createProvider = () =>
      new AssignedSkillProvider(catalog, {
        agentRuntimeName,
        workspace,
        bundleStore,
      })

    const session = new Session(stubProvider, {
      context: [
        {
          label: 'skills',
          provider: createProvider(),
        },
      ],
    })

    const initial = await session.freezeSystemPrompt()
    expect(initial).toContain('code-review')
    expect(initial).not.toContain('planning-with-files')

    catalog.replace(agentRuntimeName, [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'code-review',
        skillName: 'Code Review',
        skillDescription: 'Review code for correctness',
        skillBody: '# Code Review\nCheck for regressions.',
      }),
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-2',
        skillSlug: 'planning-with-files',
        skillName: 'Planning With Files',
        skillDescription: 'Plan and track work in files',
        skillBody: '# Planning With Files\nWrite plans to disk.',
      }),
    ])

    expect(await session.refreshSystemPrompt()).toBe(initial)

    session.removeContext('skills')
    await session.addContext('skills', {
      description: 'Enabled skills assigned to this agent.',
      provider: createProvider(),
    })
    const refreshed = await session.refreshSystemPrompt()

    expect(refreshed).toContain('code-review')
    expect(refreshed).toContain('planning-with-files')

    const loadTool = (await session.tools()).load_context as unknown as LoadToolFn
    const loaded = await loadTool.execute({
      label: 'skills',
      key: 'planning-with-files',
    })

    expect(loaded).toContain('# Planning With Files')
    expect(workspace.files.get('/.agents/skills/planning-with-files/SKILL.md')).toBe(
      '# Planning With Files\nWrite plans to disk.',
    )
  })

  it('prefers assigned workspace skills over hidden built-ins when slugs collide', async () => {
    const assignedCatalog = new MutableSkillCatalog()
    const builtinBundles: BuiltinSkillManifest[] = [
      {
        slug: 'pdf',
        name: 'pdf',
        description: 'Builtin PDF handler',
        sourceUrl: null,
        bundleHash: 'builtin-hash',
      },
    ]
    assignedCatalog.replace('primary.workspace.user', [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'pdf',
        skillName: 'pdf',
        skillDescription: 'Workspace PDF handler',
        skillBody: '# pdf\nWorkspace body',
      }),
    ])

    const mergedCatalog = new MergedSkillCatalog([
      new BuiltinSkillCatalog(builtinBundles),
      assignedCatalog,
    ])

    const listed = await mergedCatalog.listAssignedSkills({
      agentRuntimeName: 'primary.workspace.user',
    })
    const loaded = await mergedCatalog.getAssignedSkill({
      agentRuntimeName: 'primary.workspace.user',
      skillKey: 'pdf',
    })

    expect(listed).toHaveLength(1)
    expect(listed[0]?.skillDescription).toBe('Workspace PDF handler')
    expect(loaded[0]?.skillBody).toBe('# pdf\nWorkspace body')
  })

  it('renders built-in and assigned skills together through one session provider', async () => {
    const assignedCatalog = new MutableSkillCatalog()
    const workspace = new MemorySkillWorkspace()
    const builtinBundles: BuiltinSkillManifest[] = [
      {
        slug: 'pdf',
        name: 'pdf',
        description: 'Builtin PDF handler',
        sourceUrl: null,
        bundleHash: 'builtin-hash',
      },
    ]

    assignedCatalog.replace('primary.workspace.user', [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'planning-with-files',
        skillName: 'Planning With Files',
        skillDescription: 'Plan and track work',
        skillBody: '# Planning With Files\nUse templates.',
      }),
    ])

    const session = new Session(stubProvider, {
      context: [
        {
          label: 'skills',
          provider: new AssignedSkillProvider(
            new MergedSkillCatalog([
              new BuiltinSkillCatalog(builtinBundles),
              assignedCatalog,
            ]),
            {
              agentRuntimeName: 'primary.workspace.user',
              workspace,
              bundleStore: new MemorySkillBundleStore(
                new Map([
                  [
                    buildBuiltinSkillObjectKey({
                      slug: 'pdf',
                      bundleHash: 'builtin-hash',
                      path: 'SKILL.md',
                    }),
                    '# pdf\nBuiltin body',
                  ],
                ]),
              ),
            },
          ),
        },
      ],
    })

    const prompt = await session.freezeSystemPrompt()

    expect(prompt).toContain('pdf')
    expect(prompt).toContain('Builtin PDF handler')
    expect(prompt).toContain('planning-with-files')
    expect(prompt).toContain('Plan and track work')
  })
})
