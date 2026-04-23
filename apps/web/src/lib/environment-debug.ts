export interface SdkVersionInfo {
  name: string
  version: string
  channel: 'stable' | 'beta' | 'alpha'
  role: string
}

export interface WorkspaceStateEntry {
  path: string
  name: string
  type: string
  size: number
  mimeType: string
  updatedAt: number
}

export interface AgentSessionStateItem {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessage: string
  messageCount: number
}

export interface LiveAgentStatePayload {
  agentName: string
  requestedSessionId: string | null
  effectiveSessionId: string
  visibleSessionCount: number
  archivedSessionCount: number
  currentMessageCount: number
  currentPreview: string
  sessions: AgentSessionStateItem[]
  workspace: {
    rootEntries: WorkspaceStateEntry[]
    samplePaths: WorkspaceStateEntry[]
  }
  sandbox: {
    id: string
    reachable: boolean
    cwd: string | null
    workspaceListing: string
    currentDirectoryListing: string
  }
}

export interface EnvironmentDebugSnapshot {
  generatedAt: string
  workspaceId: string
  agent: {
    name: string
    requestedSessionId: string | null
    effectiveSessionId: string
    visibleSessionCount: number
    archivedSessionCount: number
    currentMessageCount: number
    currentPreview: string
  }
  sessions: AgentSessionStateItem[]
  virtualFs: {
    backingStores: string[]
    rootEntries: WorkspaceStateEntry[]
    samplePaths: WorkspaceStateEntry[]
    executeToolUsesWorkspaceState: boolean
  }
  sandbox: {
    id: string
    reachable: boolean
    cwd: string | null
    workspaceListing: string
    currentDirectoryListing: string
    explicitDoModelCallable: boolean
    firstClassThinkSandboxToolsImplemented: boolean
    callableRpcMethods: string[]
  }
  sdks: SdkVersionInfo[]
}

export const environmentDebugSnapshotSpec = {
  callableRpcMethods: [
    'ensureSandbox',
    'execSandbox',
    'readSandboxFile',
    'writeSandboxFile',
    'debugState',
  ],
  sdks: [
    {
      name: 'agents',
      version: '0.11.5',
      channel: 'stable' as const,
      role: 'Durable agent runtime, routeAgentRequest, useAgent, @callable RPCs',
    },
    {
      name: '@cloudflare/ai-chat',
      version: '0.5.1',
      channel: 'stable' as const,
      role: 'Chat transport hook on top of agents',
    },
    {
      name: '@cloudflare/think',
      version: '0.4.0',
      channel: 'stable' as const,
      role: 'Think agent base class, built-in workspace tools, execute tool',
    },
    {
      name: '@cloudflare/sandbox',
      version: '0.8.11',
      channel: 'stable' as const,
      role: 'Explicit Sandbox Durable Object and filesystem/process API',
    },
    {
      name: '@cloudflare/shell',
      version: '0.3.3',
      channel: 'stable' as const,
      role: 'Virtual filesystem over DO SQLite + R2 spillover',
    },
    {
      name: '@cloudflare/codemode',
      version: '0.3.4',
      channel: 'stable' as const,
      role: 'Worker-isolate executor behind createExecuteTool',
    },
    {
      name: '@cloudflare/vite-plugin',
      version: '1.33.0',
      channel: 'stable' as const,
      role: 'Cloudflare Worker build/runtime integration',
    },
    {
      name: 'wrangler',
      version: '4.84.0',
      channel: 'stable' as const,
      role: 'Worker deployment and binding generation',
    },
    {
      name: 'ai',
      version: '6.0.168',
      channel: 'stable' as const,
      role: 'AI SDK core used by Think and chat types',
    },
    {
      name: '@ai-sdk/openai',
      version: '3.0.53',
      channel: 'stable' as const,
      role: 'OpenAI provider support for AI SDK',
    },
    {
      name: '@ai-sdk/openai-compatible',
      version: '2.0.41',
      channel: 'stable' as const,
      role: 'OpenAI-compatible provider used for opencode-go',
    },
    {
      name: 'workers-ai-provider',
      version: '3.1.11',
      channel: 'stable' as const,
      role: 'Workers AI provider for Think agents when using Cloudflare AI',
    },
  ],
} as const

export function createEnvironmentDebugSnapshot(input: {
  workspaceId: string
  liveState: LiveAgentStatePayload
}): EnvironmentDebugSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    workspaceId: input.workspaceId,
    agent: {
      name: input.liveState.agentName,
      requestedSessionId: input.liveState.requestedSessionId,
      effectiveSessionId: input.liveState.effectiveSessionId,
      visibleSessionCount: input.liveState.visibleSessionCount,
      archivedSessionCount: input.liveState.archivedSessionCount,
      currentMessageCount: input.liveState.currentMessageCount,
      currentPreview: input.liveState.currentPreview,
    },
    sessions: input.liveState.sessions,
    virtualFs: {
      backingStores: ['Durable Object SQLite', 'R2 spillover via FILES binding'],
      rootEntries: input.liveState.workspace.rootEntries,
      samplePaths: input.liveState.workspace.samplePaths,
      executeToolUsesWorkspaceState: true,
    },
    sandbox: {
      id: input.liveState.sandbox.id,
      reachable: input.liveState.sandbox.reachable,
      cwd: input.liveState.sandbox.cwd,
      workspaceListing: input.liveState.sandbox.workspaceListing,
      currentDirectoryListing: input.liveState.sandbox.currentDirectoryListing,
      explicitDoModelCallable: false,
      firstClassThinkSandboxToolsImplemented: false,
      callableRpcMethods: [...environmentDebugSnapshotSpec.callableRpcMethods],
    },
    sdks: [...environmentDebugSnapshotSpec.sdks],
  }
}
