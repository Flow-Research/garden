import { describe, expect, it } from 'vitest'
import { Session } from 'agents/experimental/memory/session'
import type { SessionProvider } from 'agents/experimental/memory/session'
import {
  AssignedSkillProvider,
  type RuntimeSkillRecord,
  type SkillBundleStore,
  type SkillCatalog,
  type SkillWorkspace,
} from './skills'

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
    sourceUrl: input.sourceUrl ?? null,
    bundleHash: input.bundleHash ?? null,
    enabled: input.enabled ?? true,
    filePath: input.filePath ?? null,
    fileContentHash: input.fileContentHash ?? null,
    fileR2Key: input.fileR2Key ?? null,
  }
}

describe('AssignedSkillProvider session integration', () => {
  it('renders enabled assigned skills into the cached prompt inventory once per skill', async () => {
    const catalog = new MutableSkillCatalog()
    const workspace = new MemorySkillWorkspace()
    const agentRuntimeName = 'workspace:user:primary'
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
    const agentRuntimeName = 'workspace:user:primary'
    catalog.replace(agentRuntimeName, [
      createSkillRecord({
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillSlug: 'planning-with-files',
        skillName: 'Planning With Files',
        skillDescription: 'Plan and track multi-step work',
        skillBody: '# Planning With Files\nUse the templates.',
        sourceUrl: 'https://skills.sh/othmanadi/planning-with-files/planning-with-files',
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
        sourceUrl: 'https://skills.sh/othmanadi/planning-with-files/planning-with-files',
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
    expect(workspace.files.get('/.agents/skills/planning-with-files/SKILL.md')).toContain(
      '# Planning With Files',
    )
    expect(
      workspace.files.get('/.agents/skills/planning-with-files/templates/report.md'),
    ).toBe('# Report template')
    expect(
      workspace.files.get(
        '/.agents/skills/planning-with-files/references/checklist.md',
      ),
    ).toBe('# Checklist')
  })

  it('keeps the frozen prompt stable after load_context and unload_context', async () => {
    const catalog = new MutableSkillCatalog()
    const workspace = new MemorySkillWorkspace()
    const agentRuntimeName = 'workspace:user:primary'
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
})
