// ─────────────────────────────────────────────────────────────────────────────
// Per-agent Durable Object + multi-agent data-driven personas
// ─────────────────────────────────────────────────────────────────────────────
// One `AgentDO` per agent runtime name. New agents use their UUID as that
// name; migrated chat agents can keep their saved `agent.host_name` so their
// Durable Object storage remains addressable. Inside, `ChatSubAgent` facets
// are keyed by threadId and `IssueRunSubAgent` facets are keyed by issueId. Per-agent
// personality (name, role, skills, instructions, runtimeConfig, permissions)
// comes from `agent` rows in Postgres.
//
// Future moves still to land:
//   - Workspace-level WS hoist: open one WS per host at WorkspaceLayout mount,
//     register agents/threads in zustand. Tabs consume from registry instead
//     of calling useAgent themselves.
//   - Org-shared agents (deferred): drop ownerUserId NOT NULL, add org_agent
//     join, host keyed by (workspaceId, null).
// ─────────────────────────────────────────────────────────────────────────────

import {
  Session,
  Think,
  type TurnConfig,
  type TurnContext,
} from '@cloudflare/think'
import { Buffer } from 'node:buffer'
import { Agent, callable } from 'agents'
import { type LanguageModel, type Tool, type ToolSet, type UIMessage } from 'ai'
import { createWorkspaceTools } from '@cloudflare/think/tools/workspace'
import { Workspace } from '@cloudflare/shell'
import { getSandbox, type Sandbox as SandboxDO } from '@cloudflare/sandbox'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { and, asc, eq, or, type SQL } from 'drizzle-orm'
import { Result, type Result as ResultValue } from 'better-result'
import * as schema from '@garden/db/schema'
import {
  describeSandboxProbe,
  probeSandboxCommand,
  type SandboxExecResult,
} from './sandbox-debug'
import { createAgentModel } from './model'
import {
  R2SkillBundleStore,
  createAssignedSkillProvider,
  materializeAssignedSkills,
} from './skills'
import {
  PostgresAgentPromptCatalog,
  createPromptContextProviders,
} from './prompt'
import { RuntimeMcpController, type McpHost } from './runtime-mcp-controller'
import {
  MCP_PROXY_JWT_PERIODIC_REFRESH_WINDOW_MS,
  mcpRuntimeConfig,
} from './mcp-runtime-config'
import { createChatSubAgentTools } from './chat-sub-agent-tools'
import {
  getDocumentBytes,
  getDocumentVersionBytes,
  listDocumentVersions,
  registerUploadedDocument,
  resolveDocumentEdit,
} from './documents/document-tools'
import { IssueRunSubAgent } from './issue-run-sub-agent'

type AgentRuntimeEnv = Cloudflare.Env & {
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  DATABASE_URL: string
  MCP_PROXY_URL?: string
  OPENCODE_GO_API_KEY: string
  FILES: R2Bucket
  LOADER: WorkerLoader
  Sandbox: DurableObjectNamespace<SandboxDO>
}

type AgentSessionStateItem = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessage: string
  messageCount: number
}

type WorkspaceEntry = {
  path: string
  name: string
  type: string
  size: number
  mimeType: string
  updatedAt: number
}

type ToolGroup = 'workspace' | 'custom' | 'session' | 'extension' | 'mcp'

type ToolInventoryEntry = {
  key: string
  group: ToolGroup
  description: string | null
  hasExecute: boolean
  inputKeys: string[]
  /** Optional grouping hint (e.g. the extension that contributed it). */
  source: string | null
}

type RpcMethodEntry = {
  name: string
  description: string | null
  streaming: boolean
}

type ExtensionEntry = {
  name: string
  version: string
  description: string | null
  tools: string[]
  contextLabels: string[]
}

type ContextBlockEntry = {
  label: string
  contentLength: number
  preview: string
  truncated: boolean
}

type SandboxProcessEntry = {
  id: string
  command: string
  status: string
  pid: number | null
  startTime: string | null
}

type DebugMetaPayload = {
  agentName: string
  requestedSessionId: string | null
  effectiveSessionId: string
  visibleSessionCount: number
  archivedSessionCount: number
  currentMessageCount: number
  currentPreview: string
  sessions: AgentSessionStateItem[]
}

type DebugWorkspacePayload = {
  rootEntries: WorkspaceEntry[]
  samplePaths: WorkspaceEntry[]
  stats: {
    fileCount: number
    directoryCount: number
    totalBytes: number
    r2FileCount: number
  } | null
  samplePathCount: number
}

type DebugSandboxPayload = {
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

type DebugToolsPayload = {
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

type DebugPromptPayload = {
  prompt: string
  lineCount: number
  charCount: number
  contextBlocks: ContextBlockEntry[]
  loadedSkillKeys: string[]
}

type RuntimeSkillMenuEntry = {
  id: string
  slug: string
  name: string
  description: string
}

type RuntimeOkPayload = { ok: true }
type RuntimePreparePayload = { ok: true } | { ok: false; error: string }
type RuntimePrepareResult = ResultValue<void, string>
type ThreadDocumentUploadPayload = Awaited<
  ReturnType<typeof registerUploadedDocument>
>
type ThreadDocumentBytesPayload = Awaited<
  ReturnType<ChatSubAgent['readDocumentBytes']>
>
type ThreadDocumentVersionBytesPayload = Awaited<
  ReturnType<ChatSubAgent['readDocumentVersionBytes']>
>
type ThreadDocumentVersionsPayload = Awaited<
  ReturnType<ChatSubAgent['listDocumentVersions']>
>
type ThreadDocumentEditPayload = Awaited<
  ReturnType<ChatSubAgent['resolveDocumentEdit']>
>
type McpConnectionReadinessError = { message: string; serverIds: string[] }
type McpConnectionReadinessResult = ResultValue<
  void,
  McpConnectionReadinessError
>

const MCP_CONNECTOR_FULL_SYNC_INTERVAL_MS = 60 * 1000
const MCP_CONNECTION_WAIT_TIMEOUT_MS = 10_000
const THINK_TURN_TIMEOUT_MS = 60_000
const THINK_TURN_MAX_RETRIES = 1
const THINK_TURN_TELEMETRY_FUNCTION_ID = 'garden.workspace-agent.turn'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type LiveAgentStatePayload = DebugMetaPayload & {
  workspace: DebugWorkspacePayload
  sandbox: DebugSandboxPayload
  tools: DebugToolsPayload
  prompt: DebugPromptPayload
}

export class AgentDO extends Agent<AgentRuntimeEnv> {
  static override options = {
    sendIdentityOnConnect: false,
  }

  private readonly authorizedThreadIds = new Set<string>()
  private readonly authorizedIssueIds = new Set<string>()
  private identitySyncedAt = 0
  private runtimeAgentIdValue: string | undefined

  @callable()
  async ensureThread(threadId: string): Promise<RuntimeOkPayload> {
    await this.requireThreadAccess(threadId)
    await this.subAgent(ChatSubAgent, threadId)
    return { ok: true }
  }

  @callable()
  async deleteThread(threadId: string): Promise<RuntimeOkPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    await thread.pauseRuntime('delete-thread')
    await this.deleteSubAgent(ChatSubAgent, threadId)
    return { ok: true }
  }

  @callable()
  async pauseThread(threadId: string): Promise<RuntimeOkPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    await thread.pauseRuntime('archive-thread')
    return { ok: true }
  }

  @callable()
  async debugThread(threadId: string): Promise<LiveAgentStatePayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    const state = await thread.debugState()
    return {
      ...state,
      requestedSessionId: threadId,
      effectiveSessionId: threadId,
    }
  }

  @callable()
  async debugThreadMeta(threadId: string): Promise<DebugMetaPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    const meta = await thread.debugMeta()
    return {
      ...meta,
      requestedSessionId: threadId,
      effectiveSessionId: threadId,
    }
  }

  @callable()
  async debugThreadWorkspace(threadId: string): Promise<DebugWorkspacePayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    return thread.debugWorkspace()
  }

  @callable()
  async debugThreadSandbox(threadId: string): Promise<DebugSandboxPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    return thread.debugSandbox()
  }

  @callable()
  async prepareThreadSandbox(threadId: string) {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    return thread.prepareSandbox()
  }

  @callable()
  async debugThreadTools(threadId: string): Promise<DebugToolsPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    return thread.debugTools()
  }

  @callable()
  async debugThreadPrompt(threadId: string): Promise<DebugPromptPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    return thread.debugPrompt()
  }

  @callable()
  async uploadThreadDocument(
    threadId: string,
    input: { base64: string; filename: string; mediaType?: string | null },
  ): Promise<ThreadDocumentUploadPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    return thread.uploadDocument(input)
  }

  @callable()
  async readThreadDocumentBytes(
    threadId: string,
    documentId: string,
  ): Promise<ThreadDocumentBytesPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    return thread.readDocumentBytes(documentId)
  }

  @callable()
  async readThreadDocumentVersionBytes(
    threadId: string,
    input: {
      documentId: string
      preferPdf?: boolean
      versionId?: string | null
    },
  ): Promise<ThreadDocumentVersionBytesPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    return thread.readDocumentVersionBytes(input)
  }

  @callable()
  async listThreadDocumentVersions(
    threadId: string,
    documentId: string,
  ): Promise<ThreadDocumentVersionsPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    return thread.listDocumentVersions(documentId)
  }

  @callable()
  async resolveThreadDocumentEdit(
    threadId: string,
    input: {
      action: 'accept' | 'reject'
      documentId: string
      editId: string
    },
  ): Promise<ThreadDocumentEditPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    return thread.resolveDocumentEdit(input)
  }

  @callable()
  async refreshThreadSkills(threadId: string): Promise<RuntimeOkPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    await thread.refreshSkillInventory()
    return { ok: true }
  }

  @callable()
  async refreshThreadPrompt(threadId: string): Promise<RuntimeOkPayload> {
    await this.requireThreadAccess(threadId)
    const thread = await this.subAgent(ChatSubAgent, threadId)
    await thread.refreshPromptConfig()
    return { ok: true }
  }

  @callable()
  async enqueueIssueRun(input: {
    runId: string
    issueId: string
  }): Promise<void> {
    await this.requireIssueAccess(input.issueId)
    const issueAgent = await this.subAgent(IssueRunSubAgent, input.issueId)
    await issueAgent.startTurn(input)
  }

  @callable()
  async resumeIssueRun(input: {
    runId: string
    issueId: string
  }): Promise<void> {
    await this.requireIssueAccess(input.issueId)
    const issueAgent = await this.subAgent(IssueRunSubAgent, input.issueId)
    await issueAgent.resumeTurn(input)
  }

  @callable()
  async cancelIssueRun(input: {
    runId: string
    issueId: string
  }): Promise<void> {
    await this.requireIssueAccess(input.issueId)
    const issueAgent = await this.subAgent(IssueRunSubAgent, input.issueId)
    await issueAgent.requestCancel(input)
  }

  override async onBeforeSubAgent(
    _request: Request,
    child: { className: string; name: string },
  ) {
    if (
      child.className !== ChatSubAgent.name &&
      child.className !== IssueRunSubAgent.name
    ) {
      return new Response('Not found', { status: 404 })
    }

    const access =
      child.className === ChatSubAgent.name
        ? await this.checkThreadAccess(child.name)
        : await this.checkIssueAccess(child.name)
    if (!access) {
      return new Response('Not found', { status: 404 })
    }

    if (!this.hasSubAgent(child.className, child.name)) {
      if (child.className === ChatSubAgent.name) {
        await this.subAgent(ChatSubAgent, child.name)
      } else {
        await this.subAgent(IssueRunSubAgent, child.name)
      }
    }

    return undefined
  }

  private getDb() {
    return drizzle(this.env.DATABASE_URL, { schema })
  }

  private agentRuntimeWhere(): SQL {
    if (!UUID_PATTERN.test(this.name)) {
      return eq(schema.agent.hostName, this.name)
    }

    const condition = or(
      eq(schema.agent.id, this.name),
      eq(schema.agent.hostName, this.name),
    )
    return condition ?? eq(schema.agent.hostName, this.name)
  }

  private async resolveRuntimeAgentId() {
    if (this.runtimeAgentIdValue) return this.runtimeAgentIdValue

    const [row] = await this.getDb()
      .select({ id: schema.agent.id })
      .from(schema.agent)
      .where(this.agentRuntimeWhere())
      .limit(1)

    if (row) {
      this.runtimeAgentIdValue = row.id
    }

    return this.runtimeAgentIdValue ?? this.name
  }

  private async syncAgentIdentityState() {
    const now = Date.now()
    if (now - this.identitySyncedAt < 30_000) return

    const [row] = await this.getDb()
      .select({
        id: schema.agent.id,
        workspaceId: schema.agent.workspaceId,
        ownerUserId: schema.agent.ownerUserId,
        name: schema.agent.name,
        roleTitle: schema.agent.roleTitle,
        instructions: schema.agent.instructions,
        runtimeConfig: schema.agent.runtimeConfig,
        permissions: schema.agent.permissions,
        status: schema.agent.status,
      })
      .from(schema.agent)
      .where(this.agentRuntimeWhere())
      .limit(1)

    if (!row) return
    this.runtimeAgentIdValue = row.id

    const runtimeConfig =
      row.runtimeConfig &&
      typeof row.runtimeConfig === 'object' &&
      !Array.isArray(row.runtimeConfig)
        ? (row.runtimeConfig as Record<string, unknown>)
        : {}
    const permissions =
      row.permissions &&
      typeof row.permissions === 'object' &&
      !Array.isArray(row.permissions)
        ? (row.permissions as Record<string, unknown>)
        : {}

    this.ctx.storage.sql.exec(`
      create table if not exists agent_identity (
        singleton integer primary key check (singleton = 1),
        agent_id text not null,
        workspace_id text not null,
        owner_user_id text not null,
        name text not null,
        role text,
        description text,
        learned_patterns_json text not null,
        hire_history_json text not null,
        status text not null,
        updated_at text not null
      )
    `)
    this.ctx.storage.sql.exec(
      `
        insert into agent_identity (
          singleton,
          agent_id,
          workspace_id,
          owner_user_id,
          name,
          role,
          description,
          learned_patterns_json,
          hire_history_json,
          status,
          updated_at
        )
        values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(singleton) do update set
          agent_id = excluded.agent_id,
          workspace_id = excluded.workspace_id,
          owner_user_id = excluded.owner_user_id,
          name = excluded.name,
          role = excluded.role,
          description = excluded.description,
          learned_patterns_json = excluded.learned_patterns_json,
          hire_history_json = excluded.hire_history_json,
          status = excluded.status,
          updated_at = excluded.updated_at
      `,
      row.id,
      row.workspaceId,
      row.ownerUserId,
      row.name,
      row.roleTitle,
      row.instructions ?? row.roleTitle ?? '',
      JSON.stringify(runtimeConfig.learned_patterns ?? []),
      JSON.stringify(
        permissions.hire_history ?? runtimeConfig.hire_history ?? [],
      ),
      row.status,
      new Date(now).toISOString(),
    )
    this.identitySyncedAt = now
  }

  private async checkThreadAccess(threadId: string) {
    if (this.authorizedThreadIds.has(threadId)) {
      return true
    }
    await this.syncAgentIdentityState()
    const agentId = await this.resolveRuntimeAgentId()

    const [row] = await this.getDb()
      .select({ id: schema.chatThread.id })
      .from(schema.chatThread)
      .where(
        and(
          eq(schema.chatThread.agentId, agentId),
          or(
            eq(schema.chatThread.id, threadId),
            eq(schema.chatThread.runtimeKey, threadId),
          ),
        ),
      )
      .limit(1)

    if (!row) return false

    this.authorizedThreadIds.add(row.id)
    this.authorizedThreadIds.add(threadId)
    return true
  }

  private async requireThreadAccess(threadId: string) {
    if (await this.checkThreadAccess(threadId)) return
    throw new Error('Chat thread not found')
  }

  private async checkIssueAccess(issueId: string) {
    if (this.authorizedIssueIds.has(issueId)) {
      return true
    }
    await this.syncAgentIdentityState()
    const agentId = await this.resolveRuntimeAgentId()

    const [row] = await this.getDb()
      .select({ id: schema.issueRun.id })
      .from(schema.issueRun)
      .where(
        and(
          eq(schema.issueRun.issueId, issueId),
          eq(schema.issueRun.agentId, agentId),
        ),
      )
      .limit(1)

    if (!row) return false

    this.authorizedIssueIds.add(issueId)
    return true
  }

  private async requireIssueAccess(issueId: string) {
    if (await this.checkIssueAccess(issueId)) return
    throw new Error('Issue run not found')
  }
}

export class ChatSubAgent extends Think<AgentRuntimeEnv> {
  private lastProxyMcpFullSyncAt = 0
  private runtimePrepareInFlight: Promise<RuntimePrepareResult> | null = null
  private proxyMcpRefreshInFlight: Promise<RuntimePrepareResult> | null = null

  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.FILES,
    name: () => this.name,
  })
  maxSteps = 20

  getModel(): LanguageModel {
    return createAgentModel(this.env.OPENCODE_GO_API_KEY)
  }

  override async configureSession(session: Session) {
    const promptContexts = this.getPromptContextOptions()

    return session
      .withContext('foundation', promptContexts.foundation)
      .withContext('agent', promptContexts.agent)
      .withContext('workspace', promptContexts.workspace)
      .withContext('skills', this.getSkillsContextOptions())
      .withCachedPrompt()
  }

  override getTools() {
    return createChatSubAgentTools({
      databaseUrl: this.env.DATABASE_URL,
      threadId: this.name,
      workspace: this.workspace,
      loader: this.env.LOADER,
      getSandbox: () => this.getAgentSandbox(),
    })
  }

  async uploadDocument(input: {
    base64: string
    filename: string
    mediaType?: string | null
  }) {
    return registerUploadedDocument({
      context: this.getDocumentToolContext(),
      filename: input.filename,
      mediaType: input.mediaType ?? null,
      bytes: Buffer.from(input.base64, 'base64'),
    })
  }

  async readDocumentBytes(documentId: string) {
    const result = await getDocumentBytes({
      context: this.getDocumentToolContext(),
      documentId,
    })
    if (!result.ok) return result
    if (!result.bytes) {
      return { ok: false, error: 'Document bytes not found.' }
    }
    return {
      ok: true,
      filename: result.filename,
      file_type: result.file_type,
      media_type: result.media_type,
      base64: Buffer.from(result.bytes).toString('base64'),
    }
  }

  async readDocumentVersionBytes(input: {
    documentId: string
    preferPdf?: boolean
    versionId?: string | null
  }) {
    const result = await getDocumentVersionBytes({
      context: this.getDocumentToolContext(),
      documentId: input.documentId,
      preferPdf: input.preferPdf,
      versionId: input.versionId,
    })
    if (!result.ok) return result
    if (!result.bytes) {
      return { ok: false, error: 'Document bytes not found.' }
    }
    return {
      ok: true,
      created_at: result.created_at,
      display_name: result.display_name,
      filename: result.filename,
      file_type: result.file_type,
      media_type: result.media_type,
      source: result.source,
      version_id: result.version_id,
      version_number: result.version_number,
      base64: Buffer.from(result.bytes).toString('base64'),
    }
  }

  async listDocumentVersions(documentId: string) {
    return listDocumentVersions({
      context: this.getDocumentToolContext(),
      documentId,
    })
  }

  async resolveDocumentEdit(input: {
    action: 'accept' | 'reject'
    documentId: string
    editId: string
  }) {
    return resolveDocumentEdit({
      context: this.getDocumentToolContext(),
      documentId: input.documentId,
      editId: input.editId,
      action: input.action,
    })
  }

  private getDocumentToolContext() {
    return {
      databaseUrl: this.env.DATABASE_URL,
      workspace: this.workspace,
      threadId: this.name,
    }
  }

  private getDb() {
    return drizzle(this.env.DATABASE_URL, { schema })
  }

  override async onStart() {
    await this.scheduleEvery(
      mcpRuntimeConfig.proxyJwtRefreshIntervalSeconds,
      'refreshProxyMcpJwts' as keyof this,
    )
  }

  async refreshProxyMcpJwts() {
    const result = await this.ensureProxyMcpConnectionsLoaded(
      'periodic-jwt-refresh',
      {
        refreshWindowMs: MCP_PROXY_JWT_PERIODIC_REFRESH_WINDOW_MS,
      },
    )
    if (result.isErr()) {
      console.warn(
        '[agent-runtime] periodic MCP JWT refresh failed',
        result.error,
      )
    }
  }

  async pauseRuntime(reason: string): Promise<RuntimeOkPayload> {
    await this.pauseMcpRuntime(reason)
    return { ok: true }
  }

  override async beforeTurn(ctx: TurnContext) {
    const mcpController = await this.ensureProxyMcpConnectionsForTurn()
    const observedChangesResult = mcpController.captureObservedMcpToolChanges()
    if (observedChangesResult.isErr()) {
      console.warn(
        '[agent-runtime] failed to capture MCP tool changes',
        observedChangesResult.error,
      )
    }

    const documentContext =
      ctx.body &&
      typeof ctx.body.document_context === 'string' &&
      ctx.body.document_context.trim()
        ? ctx.body.document_context.trim()
        : null

    return {
      experimental_telemetry: {
        functionId: THINK_TURN_TELEMETRY_FUNCTION_ID,
        isEnabled: true,
        metadata: {
          agentClass: 'ChatSubAgent',
          hasDocumentContext: Boolean(documentContext),
        },
        recordInputs: false,
        recordOutputs: false,
      },
      maxRetries: THINK_TURN_MAX_RETRIES,
      sendReasoning: true,
      ...(documentContext
        ? { system: `${ctx.system}\n\n${documentContext}` }
        : {}),
      timeout: THINK_TURN_TIMEOUT_MS,
      tools: mcpController.wrapGetAITools(this.mcp.getAITools.bind(this.mcp)),
    } satisfies TurnConfig
  }

  override async onRequest(request: Request) {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/debug-state')) {
      return Response.json(await this.debugState())
    }

    return super.onRequest(request)
  }

  async ensureSandbox() {
    const sandbox = this.getAgentSandbox()
    const result = await sandbox.exec('pwd')
    return {
      id: this.getSandboxId(),
      success: result.success,
      cwd: result.stdout.trim() || '/workspace',
    }
  }

  async execSandbox(command: string) {
    const sandbox = this.getAgentSandbox()
    const result = await sandbox.exec(command)
    return {
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    } satisfies SandboxExecResult
  }

  async prepareSandbox() {
    const sandbox = this.getAgentSandbox()
    const result = await sandbox.exec(
      [
        'mkdir -p /workspace/.scratch',
        'node --version',
        'npm --version',
        'bun --version',
        'python3 --version',
        'git --version',
        'rg --version | head -n 1',
      ].join(' && '),
      {
        cwd: '/workspace',
        timeout: 60_000,
      },
    )

    return {
      id: this.getSandboxId(),
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    } satisfies SandboxExecResult & { id: string }
  }

  async readSandboxFile(path: string) {
    const sandbox = this.getAgentSandbox()
    return sandbox.readFile(path)
  }

  async writeSandboxFile(path: string, content: string) {
    const sandbox = this.getAgentSandbox()
    await sandbox.writeFile(path, content)
    return { ok: true }
  }

  @callable()
  async prepareRuntime(): Promise<RuntimePreparePayload> {
    const prepareResult = await this.ensureRuntimePrepared('client-prewarm')
    return prepareResult.isOk()
      ? { ok: true }
      : { ok: false, error: prepareResult.error }
  }

  @callable()
  async loadMessages(): Promise<UIMessage[]> {
    const messages = [...this.messages]
    if (messages.length > 0) return messages

    return this.loadPrimaryIssueMessages()
  }

  private async loadPrimaryIssueMessages(): Promise<UIMessage[]> {
    const db = this.getDb()
    const [thread] = await db
      .select({ primaryIssueId: schema.chatThread.primaryIssueId })
      .from(schema.chatThread)
      .where(
        or(
          eq(schema.chatThread.id, this.name),
          eq(schema.chatThread.runtimeKey, this.name),
        ),
      )
      .limit(1)

    if (!thread?.primaryIssueId) return []

    const events = await db
      .select({
        id: schema.issueRunEvent.id,
        eventType: schema.issueRunEvent.eventType,
        message: schema.issueRunEvent.message,
        stream: schema.issueRunEvent.stream,
        createdAt: schema.issueRunEvent.createdAt,
      })
      .from(schema.issueRunEvent)
      .where(eq(schema.issueRunEvent.issueId, thread.primaryIssueId))
      .orderBy(asc(schema.issueRunEvent.createdAt), asc(schema.issueRunEvent.seq))

    return events.flatMap((event) => {
      const text = event.message?.trim()
      if (!text) return []
      if (
        event.eventType !== 'issue_run:started' &&
        event.eventType !== 'issue_run:message' &&
        event.eventType !== 'issue_run:failed' &&
        event.eventType !== 'issue_run:succeeded' &&
        event.eventType !== 'issue_run:cancelled' &&
        event.eventType !== 'issue_run:blocked'
      ) {
        return []
      }

      return [
        {
          id: `issue-run-event:${event.id}`,
          role: event.stream === 'system' ? 'system' : 'assistant',
          parts: [{ type: 'text' as const, text }],
          metadata: {
            createdAt: event.createdAt?.toISOString() ?? null,
            eventType: event.eventType,
            source: 'issue_run',
          },
        } satisfies UIMessage,
      ]
    })
  }

  private async prepareRuntimeWithRetries(
    reason: string,
  ): Promise<RuntimePrepareResult> {
    const skillsResult = await Result.tryPromise({
      try: async () =>
        materializeAssignedSkills({
          agentRuntimeName: this.getAgentRuntimeName(),
          databaseUrl: this.env.DATABASE_URL,
          workspace: this.workspace,
          bundleStore: new R2SkillBundleStore(this.env.FILES),
        }),
      catch: (cause) =>
        cause instanceof Error
          ? cause.message
          : 'Failed to prepare runtime skills',
    })
    if (skillsResult.isErr()) {
      console.warn('[agent-runtime] failed to prepare runtime skills', {
        reason,
        error: skillsResult.error,
      })
      return Result.err(skillsResult.error)
    }

    return this.ensureProxyMcpConnectionsLoaded(reason)
  }

  @callable()
  async listRuntimeSkills(): Promise<RuntimeSkillMenuEntry[]> {
    await materializeAssignedSkills({
      agentRuntimeName: this.getAgentRuntimeName(),
      databaseUrl: this.env.DATABASE_URL,
      workspace: this.workspace,
      bundleStore: new R2SkillBundleStore(this.env.FILES),
    })

    const skillDirs = await this.workspace
      .readDir('/.agents/skills', { limit: 500 })
      .then(
        (entries) => entries,
        () => [] as WorkspaceEntry[],
      )

    const entries = await Promise.all(
      skillDirs
        .filter((entry) => entry.type === 'directory')
        .map(async (entry) => {
          const content = await this.workspace
            .readFile(`/.agents/skills/${entry.name}/SKILL.md`)
            .then(
              (text) => text,
              () => null,
            )

          return content
            ? parseRuntimeSkillMenuEntry(entry.name, content)
            : null
        }),
    )

    return entries
      .flatMap((entry) => (entry ? [entry] : []))
      .sort((left, right) => left.slug.localeCompare(right.slug))
  }

  async refreshSkillInventory() {
    await this.reloadSkillContext()
    return { ok: true }
  }

  async refreshPromptConfig() {
    await this.reloadPromptContext()
    return { ok: true }
  }

  async debugState(): Promise<LiveAgentStatePayload> {
    const [meta, workspace, sandbox, tools, prompt] = await Promise.all([
      this.debugMeta(),
      this.debugWorkspace(),
      this.debugSandbox(),
      this.debugTools(),
      this.debugPrompt(),
    ])
    return { ...meta, workspace, sandbox, tools, prompt }
  }

  async debugMeta(): Promise<DebugMetaPayload> {
    const preview = getThreadPreview(this.messages)
    const timestamp = new Date().toISOString()
    return {
      agentName: this.selfPath
        .map((segment) => `${segment.className}:${segment.name}`)
        .join(' / '),
      requestedSessionId: null,
      effectiveSessionId: this.name,
      visibleSessionCount: 1,
      archivedSessionCount: 0,
      currentMessageCount: this.messages.length,
      currentPreview: preview,
      sessions: [
        {
          id: this.name,
          title: 'Current thread',
          createdAt: timestamp,
          updatedAt: timestamp,
          lastMessage: preview,
          messageCount: this.messages.length,
        },
      ],
    }
  }

  async debugWorkspace(): Promise<DebugWorkspacePayload> {
    const [rootEntries, allPaths, statsSettled] = await Promise.all([
      this.workspace.readDir('/', { limit: 50 }),
      this.workspace.glob('**/*'),
      this.workspace
        .getWorkspaceInfo()
        .then((info) => ({ ok: true as const, info }))
        .catch(() => ({ ok: false as const })),
    ])
    const samplePaths = allPaths.slice(0, 50)
    const toEntry = (entry: WorkspaceEntry): WorkspaceEntry => ({
      path: entry.path,
      name: entry.name,
      type: entry.type,
      size: entry.size,
      mimeType: entry.mimeType,
      updatedAt: entry.updatedAt,
    })
    return {
      rootEntries: rootEntries.map(toEntry),
      samplePaths: samplePaths.map(toEntry),
      samplePathCount: allPaths.length,
      stats: statsSettled.ok ? statsSettled.info : null,
    }
  }

  async debugSandbox(): Promise<DebugSandboxPayload> {
    const sandboxId = this.getSandboxId()
    const sandbox = this.getAgentSandbox()

    type SettledOk<T> = { ok: true; value: T }
    type SettledErr = { ok: false; error: string }
    const settle = <T>(p: Promise<T>): Promise<SettledOk<T> | SettledErr> =>
      p.then(
        (value) => ({ ok: true as const, value }),
        (cause: unknown) => ({
          ok: false as const,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      )

    const [
      pingSettled,
      placementSettled,
      processesSettled,
      commandsSettled,
      sandboxPwdResult,
      sandboxWorkspaceListingResult,
      sandboxCurrentListingResult,
    ] = await Promise.all([
      settle(sandbox.client.utils.ping()),
      settle(sandbox.getContainerPlacementId()),
      settle(sandbox.listProcesses()),
      settle(sandbox.client.utils.getCommands()),
      probeSandboxCommand(this.execSandbox.bind(this), 'pwd'),
      probeSandboxCommand(
        this.execSandbox.bind(this),
        'ls -la /workspace 2>/dev/null || ls -la .',
      ),
      probeSandboxCommand(this.execSandbox.bind(this), 'ls -la'),
    ])

    const sandboxPwd = describeSandboxProbe(sandboxPwdResult)
    const sandboxWorkspaceListing = describeSandboxProbe(
      sandboxWorkspaceListingResult,
    )
    const sandboxCurrentListing = describeSandboxProbe(
      sandboxCurrentListingResult,
    )

    let pingMessage: string | null = null
    let reachable = sandboxPwd.success
    if (pingSettled.ok) {
      pingMessage = pingSettled.value
      reachable = reachable || pingMessage !== null
    }
    const containerPlacementId = placementSettled.ok
      ? (placementSettled.value ?? null)
      : null

    const processes: SandboxProcessEntry[] = []
    let processError: string | null = null
    if (processesSettled.ok) {
      const list = processesSettled.value as Array<{
        id?: string
        command?: string
        status?: string
        pid?: number
        startTime?: string | number | Date
      }>
      for (const proc of list) {
        processes.push({
          id: proc.id ?? '',
          command: proc.command ?? '',
          status: proc.status ?? 'unknown',
          pid: typeof proc.pid === 'number' ? proc.pid : null,
          startTime: proc.startTime
            ? new Date(proc.startTime as string | number).toISOString()
            : null,
        })
      }
    } else {
      processError = processesSettled.error
    }

    let availableCommands: string[] | null = null
    let commandsError: string | null = null
    if (commandsSettled.ok) {
      availableCommands = Array.isArray(commandsSettled.value)
        ? commandsSettled.value
        : null
    } else {
      commandsError = commandsSettled.error
    }

    return {
      id: sandboxId,
      containerPlacementId,
      reachable,
      pingMessage,
      cwd: sandboxPwd.stdout.trim() || null,
      workspaceListing:
        sandboxWorkspaceListing.stdout || sandboxWorkspaceListing.stderr,
      currentDirectoryListing:
        sandboxCurrentListing.stdout || sandboxCurrentListing.stderr,
      processes,
      processError,
      availableCommands,
      commandsError,
    }
  }

  async debugTools(): Promise<DebugToolsPayload> {
    const mcpController = this.getMcpController()
    const connectionResult = await mcpController.ensureProxyMcpConnections()
    if (connectionResult.isErr()) {
      console.warn(
        '[agent-runtime] failed to attach MCP connector tools for debug inventory',
        connectionResult.error,
      )
    }
    if (connectionResult.isOk()) {
      this.lastProxyMcpFullSyncAt = Date.now()
    }

    // Mirror what Think does inside `_runInferenceLoop` — the merged ToolSet
    // that actually reaches the model. No hand-written inventories here.
    const workspaceTools = createWorkspaceTools(this.workspace) as ToolSet
    const baseTools = (this.getTools() ?? {}) as ToolSet
    const sessionTools = (await this.session
      .tools()
      .catch(() => ({}) as ToolSet)) as ToolSet
    const extensionTools = (this.extensionManager?.getTools() ?? {}) as ToolSet
    const mcpManager = (
      this as unknown as {
        mcp?: { getAITools?: () => ToolSet }
      }
    ).mcp
    const mcpTools: ToolSet =
      typeof mcpManager?.getAITools === 'function'
        ? mcpManager.getAITools()
        : {}

    const entriesFor = (
      group: ToolGroup,
      set: ToolSet,
      sourceOf?: (key: string) => string | null,
    ): ToolInventoryEntry[] =>
      Object.entries(set).map(([key, raw]) => {
        const tool = raw as Tool & {
          inputSchema?: { properties?: Record<string, unknown> } | unknown
          execute?: unknown
        }
        const schema = tool.inputSchema as
          | { properties?: Record<string, unknown> }
          | undefined
        return {
          key,
          group,
          description:
            typeof tool.description === 'string' ? tool.description : null,
          hasExecute: typeof tool.execute === 'function',
          inputKeys: schema?.properties ? Object.keys(schema.properties) : [],
          source: sourceOf ? sourceOf(key) : null,
        }
      })

    const extensionsList = this.extensionManager?.list() ?? []
    const extensionToolOwner = new Map<string, string>()
    for (const ext of extensionsList) {
      for (const toolName of ext.tools)
        extensionToolOwner.set(toolName, ext.name)
    }

    const inventory: ToolInventoryEntry[] = [
      ...entriesFor('workspace', workspaceTools),
      ...entriesFor('custom', baseTools),
      ...entriesFor('session', sessionTools),
      ...entriesFor(
        'extension',
        extensionTools,
        (k) => extensionToolOwner.get(k) ?? null,
      ),
      ...entriesFor('mcp', mcpTools),
    ]

    const rpcMethods: RpcMethodEntry[] = Array.from(
      this.getCallableMethods().entries(),
    ).map(([name, meta]) => ({
      name,
      description: meta.description ?? null,
      streaming: meta.streaming ?? false,
    }))

    const extensions: ExtensionEntry[] = extensionsList.map((ext) => ({
      name: ext.name,
      version: ext.version,
      description: ext.description ?? null,
      tools: [...ext.tools],
      contextLabels: [...ext.contextLabels],
    }))

    const counts = {
      workspace: Object.keys(workspaceTools).length,
      custom: Object.keys(baseTools).length,
      session: Object.keys(sessionTools).length,
      extension: Object.keys(extensionTools).length,
      mcp: Object.keys(mcpTools).length,
      rpc: rpcMethods.length,
      total: inventory.length,
    }

    return {
      registeredToolKeys: Object.keys(baseTools),
      inventory,
      rpcMethods,
      extensions,
      counts,
    }
  }

  async debugPrompt(): Promise<DebugPromptPayload> {
    const prompt = await this.session.freezeSystemPrompt()

    const blocks = this.session.getContextBlocks() ?? []
    const contextBlocks: ContextBlockEntry[] = blocks.map((block) => {
      const raw = (block as { content?: unknown }).content
      const content = typeof raw === 'string' ? raw : ''
      const MAX_PREVIEW = 600
      const truncated = content.length > MAX_PREVIEW
      return {
        label: (block as { label: string }).label,
        contentLength: content.length,
        preview: truncated ? `${content.slice(0, MAX_PREVIEW)}…` : content,
        truncated,
      }
    })

    const loadedSkillKeys = Array.from(
      this.session.getLoadedSkillKeys?.() ?? [],
    )

    return {
      prompt,
      lineCount: prompt.split('\n').length,
      charCount: prompt.length,
      contextBlocks,
      loadedSkillKeys,
    }
  }

  private getSandboxId() {
    const pathKey = this.selfPath.map((segment) => segment.name).join('-')
    const candidate = pathKey || this.name
    if (candidate.length <= 63) {
      return candidate
    }

    return [
      this.compactSandboxSegment(
        this.parentPath.at(-1)?.name || 'agent-do',
        20,
      ),
      this.compactSandboxSegment(this.name, 20),
      this.hashSandboxId(candidate),
    ].join('-')
  }

  private getAgentRuntimeName() {
    return this.parentPath.at(-1)?.name ?? this.name
  }

  private getMcpController() {
    const host: McpHost = {
      name: this.name,
      env: this.env,
      ctx: this.ctx,
      mcp: this.mcp,
      removeMcpServer: this.removeMcpServer.bind(this),
    }
    return new RuntimeMcpController(host)
  }

  private async ensureProxyMcpConnectionsForTurn() {
    const mcpController = this.getMcpController()
    const now = Date.now()
    const warmResult = mcpController.hasWarmProxyMcpConnections(now)

    if (
      warmResult.isOk() &&
      warmResult.value &&
      now - this.lastProxyMcpFullSyncAt < MCP_CONNECTOR_FULL_SYNC_INTERVAL_MS
    ) {
      const readinessResult =
        await this.waitForMcpConnectionsReady('before-turn')
      if (readinessResult.isOk()) {
        return mcpController
      }

      console.warn('[agent-runtime] warm MCP connector state is stale', {
        error: readinessResult.error.message,
        serverIds: readinessResult.error.serverIds,
      })

      const resetResult = await mcpController.resetProxyMcpServers(
        readinessResult.error.serverIds.length > 0
          ? readinessResult.error.serverIds
          : undefined,
      )
      if (resetResult.isErr()) {
        console.warn(
          '[agent-runtime] failed to reset stale MCP connector servers',
          resetResult.error,
        )
      }
    }

    if (warmResult.isErr()) {
      console.warn(
        '[agent-runtime] failed to inspect warm MCP connector state',
        warmResult.error,
      )
    }

    const readyResult =
      await this.ensureProxyMcpConnectionsLoaded('before-turn')
    if (readyResult.isErr()) {
      throw new Error(`MCP tools are not ready: ${readyResult.error}`)
    }

    return mcpController
  }

  private ensureRuntimePrepared(reason: string) {
    if (this.runtimePrepareInFlight) return this.runtimePrepareInFlight

    this.runtimePrepareInFlight = this.prepareRuntimeWithRetries(reason).then(
      (result) => {
        this.runtimePrepareInFlight = null
        return result
      },
      (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        console.warn('[agent-runtime] runtime background prepare failed', {
          reason,
          error: message,
        })
        this.runtimePrepareInFlight = null
        return Result.err(message)
      },
    )

    return this.runtimePrepareInFlight
  }

  private ensureProxyMcpConnectionsLoaded(
    reason: string,
    options?: { refreshWindowMs?: number },
  ) {
    if (this.proxyMcpRefreshInFlight) return this.proxyMcpRefreshInFlight

    this.proxyMcpRefreshInFlight = this.refreshProxyMcpConnectionsWithRetries(
      reason,
      options,
    ).then(
      (result) => {
        this.proxyMcpRefreshInFlight = null
        return result
      },
      (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        console.warn('[agent-runtime] MCP background refresh failed', {
          reason,
          error: message,
        })
        this.proxyMcpRefreshInFlight = null
        return Result.err(message)
      },
    )

    return this.proxyMcpRefreshInFlight
  }

  private async refreshProxyMcpConnectionsWithRetries(
    reason: string,
    options?: { refreshWindowMs?: number },
  ): Promise<RuntimePrepareResult> {
    const delaysMs = [0, 1_000, 3_000]
    let lastError = 'MCP connector refresh failed'

    for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
      const delayMs = delaysMs[attempt] ?? 0
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      const mcpController = this.getMcpController()
      const connectionResult =
        await mcpController.ensureProxyMcpConnections(options)
      if (connectionResult.isOk()) {
        const readinessResult = await this.waitForMcpConnectionsReady(reason)
        if (readinessResult.isErr()) {
          lastError = readinessResult.error.message
          console.warn('[agent-runtime] MCP connector readiness check failed', {
            reason,
            attempt: attempt + 1,
            error: readinessResult.error.message,
            serverIds: readinessResult.error.serverIds,
          })

          const resetResult = await mcpController.resetProxyMcpServers(
            readinessResult.error.serverIds.length > 0
              ? readinessResult.error.serverIds
              : undefined,
          )
          if (resetResult.isErr()) {
            lastError = resetResult.error.message
            console.warn(
              '[agent-runtime] failed to reset stale MCP connector servers',
              resetResult.error,
            )
          }
          continue
        }

        this.lastProxyMcpFullSyncAt = Date.now()

        const observedChangesResult =
          mcpController.captureObservedMcpToolChanges()
        if (observedChangesResult.isErr()) {
          console.warn(
            '[agent-runtime] failed to capture refreshed MCP tool changes',
            observedChangesResult.error,
          )
        }
        return Result.ok(undefined)
      }

      if (connectionResult.error.code === 'thread_not_found') {
        await this.pauseMcpRuntime(reason, mcpController)
        return Result.ok(undefined)
      }

      lastError = connectionResult.error.message
      console.warn('[agent-runtime] MCP connector refresh failed', {
        reason,
        attempt: attempt + 1,
        error: connectionResult.error,
      })
    }

    return Result.err(lastError)
  }

  private async pauseMcpRuntime(
    reason: string,
    mcpController = this.getMcpController(),
  ) {
    const resetResult = await mcpController.resetProxyMcpServers()
    if (resetResult.isErr()) {
      console.warn(
        '[agent-runtime] failed to reset MCP connectors for paused chat facet',
        {
          reason,
          agentName: this.name,
          error: resetResult.error,
        },
      )
    }

    const schedulesResult = await Result.tryPromise({
      try: async () => await this.listSchedules(),
      catch: (cause) =>
        cause instanceof Error ? cause.message : String(cause),
    })
    if (schedulesResult.isErr()) {
      console.warn(
        '[agent-runtime] failed to inspect schedules for paused chat facet',
        {
          reason,
          agentName: this.name,
          error: schedulesResult.error,
        },
      )
      return
    }

    const refreshSchedules = schedulesResult.value.filter(
      (schedule) => schedule.callback === 'refreshProxyMcpJwts',
    )
    for (const schedule of refreshSchedules) {
      const cancelResult = await Result.tryPromise({
        try: async () => await this.cancelSchedule(schedule.id),
        catch: (cause) =>
          cause instanceof Error ? cause.message : String(cause),
      })
      if (cancelResult.isErr()) {
        console.warn(
          '[agent-runtime] failed to cancel paused chat MCP refresh schedule',
          {
            reason,
            agentName: this.name,
            scheduleId: schedule.id,
            error: cancelResult.error,
          },
        )
      }
    }

    console.warn('[agent-runtime] paused MCP refresh for chat facet', {
      reason,
      agentName: this.name,
      cancelledSchedules: refreshSchedules.length,
    })
  }

  private async waitForMcpConnectionsReady(
    reason: string,
  ): Promise<McpConnectionReadinessResult> {
    const waitResult = await Result.tryPromise({
      try: async () =>
        this.mcp.waitForConnections({
          timeout: MCP_CONNECTION_WAIT_TIMEOUT_MS,
        }),
      catch: (cause) =>
        cause instanceof Error
          ? cause.message
          : 'Failed waiting for MCP connections',
    })
    if (waitResult.isErr()) {
      return Result.err({
        message: waitResult.error,
        serverIds: [],
      })
    }

    const servers = this.getMcpServers().servers
    const notReadyServers = Object.entries(servers).flatMap(
      ([serverId, server]) => {
        if (server.state === 'ready') return []
        return [
          {
            id: serverId,
            state: server.state,
            error: server.error,
          },
        ]
      },
    )

    if (notReadyServers.length === 0) {
      return Result.ok(undefined)
    }

    return Result.err({
      message: `MCP servers are not ready after ${reason}: ${notReadyServers
        .map((server) =>
          server.error
            ? `${server.id}:${server.state} (${server.error})`
            : `${server.id}:${server.state}`,
        )
        .join(', ')}`,
      serverIds: notReadyServers.map((server) => server.id),
    })
  }

  private getPromptContextOptions() {
    return createPromptContextProviders({
      agentRuntimeName: this.getAgentRuntimeName(),
      catalog: new PostgresAgentPromptCatalog(this.env.DATABASE_URL),
    })
  }

  private getSkillsContextOptions() {
    return {
      description:
        'Enabled skills assigned to this agent. Load by key when needed.',
      provider: createAssignedSkillProvider({
        agentRuntimeName: this.getAgentRuntimeName(),
        databaseUrl: this.env.DATABASE_URL,
        workspace: this.workspace,
        bundleStore: new R2SkillBundleStore(this.env.FILES),
      }),
    }
  }

  private async reloadSkillContext() {
    const skillOptions = this.getSkillsContextOptions()
    this.session.removeContext('skills')
    await this.session.addContext('skills', skillOptions)
    await this.session.refreshSystemPrompt()
    await materializeAssignedSkills({
      agentRuntimeName: this.getAgentRuntimeName(),
      databaseUrl: this.env.DATABASE_URL,
      workspace: this.workspace,
      bundleStore: new R2SkillBundleStore(this.env.FILES),
    })
  }

  private async reloadPromptContext() {
    const promptContexts = this.getPromptContextOptions()
    this.session.removeContext('agent')
    this.session.removeContext('workspace')
    await this.session.addContext('agent', promptContexts.agent)
    await this.session.addContext('workspace', promptContexts.workspace)
    await this.session.refreshSystemPrompt()
  }

  private compactSandboxSegment(value: string, maxLength: number) {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    if (!normalized) {
      return 'sandbox'
    }

    return normalized.slice(0, maxLength)
  }

  private hashSandboxId(value: string) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }

    return (hash >>> 0).toString(16)
  }

  private getAgentSandbox() {
    return getSandbox(this.env.Sandbox, this.getSandboxId(), {
      normalizeId: true,
      sleepAfter: '5m',
      transport: 'rpc',
    })
  }
}

function getThreadPreview(messages: UIMessage[]) {
  const latest = messages[messages.length - 1]
  if (!latest) return ''

  const text = latest.parts
    .flatMap((part) => {
      if (part.type === 'text' && typeof part.text === 'string') {
        return [part.text.trim()]
      }
      if (part.type === 'file') {
        const filePart = part as { filename?: string; name?: string }
        return [filePart.filename || filePart.name || 'Attachment']
      }
      return []
    })
    .filter(Boolean)
    .join(' ')
    .trim()

  if (!text) return ''
  return text.length > 120 ? `${text.slice(0, 120).trimEnd()}…` : text
}

function parseRuntimeSkillMenuEntry(
  slug: string,
  content: string,
): RuntimeSkillMenuEntry {
  const frontmatter = parseSkillFrontmatter(content)
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const name = frontmatter.name || heading || slug
  return {
    id: slug,
    slug,
    name,
    description: frontmatter.description,
  }
}

function parseSkillFrontmatter(content: string) {
  if (!content.startsWith('---\n')) {
    return { name: '', description: '' }
  }

  const end = content.indexOf('\n---', 4)
  if (end < 0) {
    return { name: '', description: '' }
  }

  const fields = new Map<string, string>()
  for (const line of content.slice(4, end).split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 0) continue

    const key = line.slice(0, separator).trim().toLowerCase()
    const rawValue = line.slice(separator + 1).trim()
    fields.set(key, rawValue.replace(/^['"]|['"]$/g, ''))
  }

  return {
    name: fields.get('name') ?? '',
    description: fields.get('description') ?? '',
  }
}
