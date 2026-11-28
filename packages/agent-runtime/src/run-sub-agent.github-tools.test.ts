import type { ToolSet } from 'ai'
import { Result } from 'better-result'
import { Effect, Layer } from 'effect'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import {
  listAvailableConnectorBindings,
  type AvailableConnectorBinding,
} from '@garden/server/connectors/availability'
import { DEFAULT_AGENT_PERMISSIONS } from '@garden/core/agents/permissions'
import { NO_TEAM_AGENT_POLICY } from '@garden/core/teams/agent-policy'
import { createGardenLogger } from '@garden/observability/logger'
import { AutomationRunSubAgent } from './automation-run-sub-agent'
import {
  evaluateRuntimeToolPermission,
  isTeamToolAllowed,
} from './chat-permissions'
import { mcpRuntimeConfig } from './mcp-runtime-config'
import { RunSubAgentBase } from './run-sub-agent-base'
import { RuntimeMcpController } from './runtime-mcp-controller'

vi.mock('@cloudflare/think', () => ({
  Think: class {},
  defaultContextOverflowClassifier: () => false,
}))
vi.mock('@cloudflare/think/tools/execute', () => ({}))
vi.mock('@cloudflare/computer', () => ({ Workspace: class {} }))
vi.mock('@cloudflare/computer/tools/ai-sdk', () => ({
  createAITools: () => ({}),
}))
vi.mock('@cloudflare/sandbox', () => ({ getSandbox: vi.fn() }))
vi.mock('agents', () => ({
  Agent: class {},
  getAgentByName: vi.fn(),
  routeAgentRequest: vi.fn(),
  callable: () => () => undefined,
}))
vi.mock('agents/mcp', () => ({ McpAgent: class {} }))
vi.mock('agents/mcp/client', () => ({}))
vi.mock('agents/skills', () => ({}))
vi.mock('agents/workflows', () => ({ AgentWorkflow: class {} }))
vi.mock('agents/browser/ai', () => ({}))
vi.mock('agents/sessions', () => ({ createCompactFunction: () => () => ({}) }))
vi.mock('agents/context', () => ({ ContextBlocks: class {} }))
vi.mock('@garden/server/connectors/availability', () => ({
  listAvailableConnectorBindings: vi.fn(),
}))
vi.mock('@garden/connectors/github/mcp-client', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@garden/connectors/github/mcp-client')
    >()
  return {
    ...actual,
    makeGitHubHostedMcpBaseLayer: () =>
      Layer.succeed(actual.GitHubHostedMcpClient, {
        listTools: () =>
          Effect.succeed([
            {
              name: 'issue_write',
              description: 'Write an issue',
              inputSchema: { type: 'object' },
            },
          ]),
        callTool: () => Effect.succeed({}),
      }),
  }
})

const PRIVATE_KEY = 'sentinel-github-app-private-key'
const NATIVE_KEY = buildMcpAiToolKey('github', 'search_repositories')
const HOSTED_KEY = buildMcpAiToolKey('github-mcp', 'issue_write')
const DECIDE_KEY = buildMcpAiToolKey('executor', 'decide_analyze')
const connected: AvailableConnectorBinding[] = [
  {
    connectorId: 'github',
    accountId: '123',
    accountLogin: 'garden',
    authKind: 'github_app',
    status: 'connected',
  },
]

function createRunFacet(owner: { current: unknown } = { current: null }) {
  const servers: { id: string; name: string }[] = []
  const callTool = vi.fn(async (_input: unknown) => ({ content: [] }))
  const facet = Object.create(RunSubAgentBase.prototype)
  Object.assign(facet, {
    name: 'issue-facet',
    currentRunId: 'run-a',
    mcpRuntime: null,
    env: {
      BETTER_AUTH_SECRET: 'test',
      BETTER_AUTH_URL: 'https://garden.test',
      GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
      HYPERDRIVE: { connectionString: 'postgres://garden.test/db' },
    },
    ctx: {
      storage: {
        sql: { exec: () => ({ toArray: () => [], one: () => ({}) }) },
      },
    },
    mcp: {
      getAITools: () => ({
        [DECIDE_KEY]: { description: 'Decide', execute: async () => ({}) },
      }),
      listTools: () => [
        { serverId: 'executor', name: 'decide_analyze', description: 'Decide' },
      ],
      listServers: () => servers,
      callTool,
      waitForConnections: async () => undefined,
    },
    runConfig: () => ({
      logger: createGardenLogger({ service: 'test', component: 'test' }),
    }),
    getMcpServers: () => ({ servers: {} }),
    addMcpServer: async (
      name: string,
      _binding: unknown,
      input: { id: string },
    ) => {
      servers.push({ id: input.id, name })
      return { state: 'ready' }
    },
    removeMcpServer: async () => undefined,
    resolveMcpIdentity: async () =>
      Result.ok({
        threadId: 'issue-facet',
        workspaceId: 'workspace',
        userId: 'owner',
        agentId: 'agent',
      }),
    decideAnalysisOwner: () => owner.current,
  })
  const prepare: (reason: string) => Promise<RuntimeMcpController> =
    Reflect.get(facet, 'prepareMcpForTurn').bind(facet)
  const turnTools = async () => {
    const controller = await prepare('issue-turn')
    const tools = controller.wrapGetAITools(() => facet.mcp.getAITools())
    return {
      controller,
      tools,
      active: controller.activeToolKeysWithoutRawMcp({
        assembledTools: {},
        stableMcpTools: tools,
      }),
    }
  }
  return { facet, callTool, turnTools }
}

const executeTool = async (tools: ToolSet, key: string) =>
  await tools[key]?.execute?.(
    {},
    {
      toolCallId: 'call',
      messages: [],
      context: {},
    },
  )

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  )
  vi.mocked(listAvailableConnectorBindings).mockReset()
  vi.mocked(listAvailableConnectorBindings).mockResolvedValue(connected)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('run facet GitHub tools', () => {
  it('exposes native and hosted GitHub tools on the prepared turn', async () => {
    const { turnTools } = createRunFacet()
    const { tools, active } = await turnTools()

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([NATIVE_KEY, HOSTED_KEY]),
    )
    expect(active).toEqual(expect.arrayContaining([NATIVE_KEY, HOSTED_KEY]))
  })

  it('keeps the tools on a warm later turn of the same run', async () => {
    const { turnTools } = createRunFacet()
    await turnTools()
    const { tools } = await turnTools()

    expect(tools).toHaveProperty(NATIVE_KEY)
    expect(listAvailableConnectorBindings).toHaveBeenCalledTimes(1)
  })

  it('reloads accounts for a new run inside the warm window', async () => {
    const { facet, turnTools } = createRunFacet()
    await turnTools()
    vi.mocked(listAvailableConnectorBindings).mockResolvedValue([])
    facet.currentRunId = 'run-b'
    const { tools } = await turnTools()

    expect(tools).not.toHaveProperty(NATIVE_KEY)
    expect(tools).not.toHaveProperty(HOSTED_KEY)
  })

  it('drops GitHub tools on the next refresh after a revoke', async () => {
    const { turnTools } = createRunFacet()
    await turnTools()
    vi.mocked(listAvailableConnectorBindings).mockResolvedValue([])
    vi.setSystemTime(Date.now() + mcpRuntimeConfig.connectorFullSyncIntervalMs)
    const { tools, active } = await turnTools()

    expect(tools).not.toHaveProperty(NATIVE_KEY)
    expect(tools).not.toHaveProperty(HOSTED_KEY)
    expect(active).not.toContain(HOSTED_KEY)
  })

  it('reads the Decide owner per call from a reused controller', async () => {
    const owner: { current: unknown } = {
      current: { kind: 'automation_run', automationRunId: 'run-a' },
    }
    const { callTool, turnTools } = createRunFacet(owner)
    const { tools } = await turnTools()
    await executeTool(tools, DECIDE_KEY)
    owner.current = { kind: 'automation_run', automationRunId: 'run-b' }
    await executeTool(tools, DECIDE_KEY)
    owner.current = null
    await executeTool(tools, DECIDE_KEY)

    expect(callTool.mock.calls.map(([input]) => input)).toMatchObject([
      { _meta: { garden: { automationRunId: 'run-a' } } },
      { _meta: { garden: { automationRunId: 'run-b' } } },
      { _meta: { garden: { kind: 'chat', threadId: 'issue-facet' } } },
    ])
  })

  it('keeps ask tools behind the connector approval gate', async () => {
    const gate = vi.fn(async () => Result.ok(true))
    const proto = RuntimeMcpController.prototype
    const gateName = 'ensureConnectorToolNeedsApproval'
    const original: unknown = Reflect.get(proto, gateName)
    Reflect.set(proto, gateName, gate)
    onTestFinished(() => {
      Reflect.set(proto, gateName, original)
    })
    const { turnTools } = createRunFacet()
    const { tools } = await turnTools()
    const options = { toolCallId: 'call', messages: [], context: {} }
    const needsApproval = async (key: string) => {
      const check = tools[key]?.needsApproval
      return typeof check === 'function' ? await check({}, options) : check
    }

    await expect(needsApproval(NATIVE_KEY)).resolves.toBe(true)
    await expect(needsApproval(HOSTED_KEY)).resolves.toBe(true)
    expect(gate).toHaveBeenCalledTimes(2)
  })

  it('lets Team policy remove GitHub keys from active tools', async () => {
    const { turnTools } = createRunFacet()
    const { active } = await turnTools()
    const policy = {
      ...NO_TEAM_AGENT_POLICY,
      blockedConnectorIds: new Map([
        ['github', { teamId: 'team', teamName: 'Team' }],
      ]),
    }
    const allowed = active.filter((key) => isTeamToolAllowed(policy, key))

    expect(allowed).not.toContain(NATIVE_KEY)
    expect(allowed).not.toContain(HOSTED_KEY)
  })

  it('applies agent connector limits to hosted GitHub tools', () => {
    const decision = evaluateRuntimeToolPermission(
      {
        ...DEFAULT_AGENT_PERMISSIONS,
        full_access: false,
        allowed_connectors: ['slack'],
      },
      NO_TEAM_AGENT_POLICY,
      HOSTED_KEY,
    )

    expect(decision.allowed).toBe(false)
  })

  it('applies automation closure controls to hosted GitHub writes', () => {
    const automation = Object.create(AutomationRunSubAgent.prototype)
    Object.assign(automation, {
      currentBrowserAllowed: false,
      currentClosureControls: {
        closureAction: 'report-only',
        allowSourceMutation: false,
      },
      currentPermissions: null,
      currentTeamPolicy: NO_TEAM_AGENT_POLICY,
    })
    const result = Reflect.get(automation, 'assertToolAllowed').call(
      automation,
      HOSTED_KEY,
    )

    expect(result.isErr()).toBe(true)
  })

  it('keeps the GitHub App key out of model-visible tools', async () => {
    const { turnTools } = createRunFacet()
    const { tools } = await turnTools()

    expect(JSON.stringify(tools)).not.toContain(PRIVATE_KEY)
  })
})
