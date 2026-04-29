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

export type ToolGroup =
  | 'workspace'
  | 'custom'
  | 'session'
  | 'extension'
  | 'mcp'

export interface ToolInventoryEntry {
  key: string
  group: ToolGroup
  description: string | null
  hasExecute: boolean
  inputKeys: string[]
  source: string | null
}

export interface RpcMethodEntry {
  name: string
  description: string | null
  streaming: boolean
}

export interface ExtensionEntry {
  name: string
  version: string
  description: string | null
  tools: string[]
  contextLabels: string[]
}

export interface ContextBlockEntry {
  label: string
  contentLength: number
  preview: string
  truncated: boolean
}

export interface SandboxProcessEntry {
  id: string
  command: string
  status: string
  pid: number | null
  startTime: string | null
}

export interface DebugMetaPayload {
  agentName: string
  requestedSessionId: string | null
  effectiveSessionId: string
  visibleSessionCount: number
  archivedSessionCount: number
  currentMessageCount: number
  currentPreview: string
  sessions: AgentSessionStateItem[]
}

export interface DebugWorkspacePayload {
  rootEntries: WorkspaceStateEntry[]
  samplePaths: WorkspaceStateEntry[]
  samplePathCount: number
  stats: {
    fileCount: number
    directoryCount: number
    totalBytes: number
    r2FileCount: number
  } | null
}

export interface DebugSandboxPayload {
  id: string
  containerPlacementId: string | null
  reachable: boolean
  pingMessage: string | null
  cwd: string | null
  workspaceListing: string
  currentDirectoryListing: string
  processes: SandboxProcessEntry[]
  processError: string | null
  availableCommands: string[] | null
  commandsError: string | null
}

export interface DebugToolsPayload {
  registeredToolKeys: string[]
  inventory: ToolInventoryEntry[]
  rpcMethods: RpcMethodEntry[]
  extensions: ExtensionEntry[]
  counts: {
    workspace: number
    custom: number
    session: number
    extension: number
    mcp: number
    rpc: number
    total: number
  }
}

export interface DebugPromptPayload {
  prompt: string
  lineCount: number
  charCount: number
  contextBlocks: ContextBlockEntry[]
  loadedSkillKeys: string[]
}

export interface LiveAgentStatePayload extends DebugMetaPayload {
  workspace: DebugWorkspacePayload
  sandbox: DebugSandboxPayload
  tools: DebugToolsPayload
  prompt: DebugPromptPayload
}

/**
 * SDK stack metadata. Demoted to a single collapsible strip in the drawer —
 * it's secondary context, not primary debug info.
 */
export const DEBUG_SDK_STACK: readonly SdkVersionInfo[] = [
  {
    name: 'agents',
    version: '0.11.9',
    channel: 'stable',
    role: 'Durable agent runtime, routeAgentRequest, useAgent, @callable RPCs',
  },
  {
    name: '@cloudflare/ai-chat',
    version: '0.5.4',
    channel: 'stable',
    role: 'Chat transport hook on top of agents',
  },
  {
    name: '@cloudflare/think',
    version: '0.4.2',
    channel: 'stable',
    role: 'Think agent base, workspace tools, execute tool',
  },
  {
    name: '@cloudflare/sandbox',
    version: '0.9.2',
    channel: 'stable',
    role: 'Explicit Sandbox DO, fs/process API',
  },
  {
    name: '@cloudflare/shell',
    version: '0.3.5',
    channel: 'stable',
    role: 'VFS over DO SQLite + R2 spillover',
  },
  {
    name: '@cloudflare/codemode',
    version: '0.3.4',
    channel: 'stable',
    role: 'Worker-isolate executor behind createExecuteTool',
  },
  {
    name: 'ai',
    version: '6.0.168',
    channel: 'stable',
    role: 'AI SDK core used by Think and chat types',
  },
]

export const VIRTUAL_FS_BACKING_STORES = [
  'Durable Object SQLite',
  'R2 spillover via FILES binding',
] as const
