import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolSet } from 'ai'
import { Result } from 'better-result'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import {
  RuntimeMcpController,
  type McpHost,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'

const ACCOUNT = 'Flow-Research'

type ExecutableTool = {
  execute: (input: unknown, options: unknown) => Promise<unknown>
}

/**
 * Drives real GitHub tool calls through the controller's tool assembly
 * (`wrapGetAITools`) with the active installation set directly, mirroring
 * runtime-mcp-controller.github-assignees.test.ts. The hosted callTool and
 * global fetch are stubbed so no request can leave the process; the native
 * surface needs no network because the mint fails locally on the empty env.
 *
 * `accountLogin` models `github_app_installation.account_login` as threaded
 * through `activateNativeConnectorBindings` (#332).
 */
function githubToolSurface(accountLogin?: string) {
  const callTool = vi.fn(async () => ({ ok: true }))
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  const identity: ThreadRuntimeIdentity = {
    threadId: randomUUID(),
    workspaceId: randomUUID(),
    userId: randomUUID(),
    agentId: randomUUID(),
  }
  const host: McpHost = {
    name: 'github-owner-probe',
    env: {
      BETTER_AUTH_SECRET: '',
      BETTER_AUTH_URL: 'http://localhost:3000',
      HYPERDRIVE: {
        connectionString: '',
      } as McpHost['env']['HYPERDRIVE'],
    },
    ctx: { storage: { sql: {} as McpHost['ctx']['storage']['sql'] } },
    mcp: {
      getAITools: () => ({}) as ToolSet,
      callTool: async () => ({}),
      listTools: () => [],
      listServers: () => [],
      discoverIfConnected: async () => ({ success: false }),
    },
    removeMcpServer: async () => {},
    githubHostedMcp: { listTools: async () => [], callTool },
    resolveRuntimeIdentity: async () => Result.ok(identity),
  }

  const controller = new RuntimeMcpController(host)
  const accounts = Reflect.get(
    controller,
    'activeNativeConnectorAccounts',
  ) as Map<
    string,
    {
      accountId: string | null
      accountLogin?: string | null
      status: 'connected' | 'degraded'
    }
  >
  accounts.set('github', {
    accountId: '42',
    status: 'connected',
    accountLogin,
  })
  Reflect.set(controller, 'activeGitHubHostedMcpTools', [
    { name: 'list_issues', description: 'hosted', inputSchema: {} },
    { name: 'issue_write', description: 'hosted', inputSchema: {} },
  ])

  const tools = controller.wrapGetAITools(() => ({}) as ToolSet, undefined)
  const hosted = (name: string) =>
    tools[buildMcpAiToolKey('github-mcp', name)] as ExecutableTool | undefined
  const native = (name: string) =>
    tools[buildMcpAiToolKey('github', name)] as ExecutableTool | undefined
  const run = (
    tool: ExecutableTool | undefined,
    input: unknown,
  ): Promise<unknown> => {
    if (!tool) throw new Error('Expected tool to be assembled')
    return tool.execute(input, { toolCallId: randomUUID(), messages: [] })
  }
  return {
    callTool,
    fetchSpy,
    runHostedRead: (input: unknown) => run(hosted('list_issues'), input),
    runHostedWrite: (input: unknown) => run(hosted('issue_write'), input),
    runNativeRead: (input: unknown) => run(native('list_branches'), input),
    runNativeWrite: (input: unknown) => run(native('issue_write'), input),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('github owner identity gate (#332)', () => {
  // Reads are context, not state changes: a public repo outside the install
  // account is still worth reading, and a wrong-owner read reaches GitHub's
  // 404 + retry hint instead of being refused locally.
  it('lets a read of another owner through on the hosted surface', async () => {
    const { runHostedRead, callTool } = githubToolSurface(ACCOUNT)
    const input = { owner: 'cloudflare', repo: 'agents', state: 'open' }
    await expect(runHostedRead(input)).resolves.toEqual({ ok: true })
    expect(callTool).toHaveBeenCalledWith('42', 'list_issues', input)
  })

  it('corrects a case-variant owner on the hosted read', async () => {
    const { runHostedRead, callTool } = githubToolSurface(ACCOUNT)
    const input = { owner: 'flow-research', repo: 'garden', state: 'open' }
    await expect(runHostedRead(input)).resolves.toEqual({ ok: true })
    expect(callTool).toHaveBeenCalledWith('42', 'list_issues', {
      ...input,
      owner: ACCOUNT,
    })
  })

  it('passes the owner through untouched when no canonical login is known', async () => {
    const { runHostedRead, callTool } = githubToolSurface(undefined)
    const input = { owner: 'anything', repo: 'garden' }
    await expect(runHostedRead(input)).resolves.toEqual({ ok: true })
    expect(callTool).toHaveBeenCalledWith('42', 'list_issues', input)
  })

  // The native surface shares the gate. A rejected write returns before the
  // Effect layer runs, so no mint and no fetch happen.
  it('rejects a hallucinated owner on the native write before any request', async () => {
    const { runNativeWrite, fetchSpy } = githubToolSurface(ACCOUNT)
    const result = await runNativeWrite({
      owner: 'flowresearch',
      repo: 'garden',
    })
    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('is not the connected GitHub account'),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a hallucinated owner on the hosted write before dispatch', async () => {
    const { runHostedWrite, callTool } = githubToolSurface(ACCOUNT)
    const result = await runHostedWrite({
      owner: 'flowresearch',
      repo: 'garden',
      title: 'Fix',
    })
    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining(ACCOUNT),
    })
    expect(callTool).not.toHaveBeenCalled()
  })

  // A matching owner passes the gate and reaches the tool handler; the call
  // then fails locally at the mint because the probe env holds no App
  // credentials, which is exactly how the test proves the gate let it through
  // without touching the network.
  it('lets a matching owner through to the native tool handler', async () => {
    const { runNativeRead, fetchSpy } = githubToolSurface(ACCOUNT)
    const result = await runNativeRead({ owner: ACCOUNT, repo: 'garden' })
    expect(result).toMatchObject({
      message: expect.stringContaining('github.list_branches failed'),
    })
    expect(result).not.toMatchObject({
      message: expect.stringContaining('is not the connected GitHub account'),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('corrects a case-variant owner on a hosted write before dispatch', async () => {
    const { runHostedWrite, callTool } = githubToolSurface(ACCOUNT)
    const input = {
      owner: 'flow-research',
      repo: 'garden',
      title: 'Fix',
    }
    await expect(runHostedWrite(input)).resolves.toEqual({ ok: true })
    expect(callTool).toHaveBeenCalledWith('42', 'issue_write', {
      ...input,
      owner: ACCOUNT,
    })
  })
})
