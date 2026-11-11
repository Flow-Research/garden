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
  const host = {
    name: 'github-owner-probe',
    env: {},
    ctx: { storage: { sql: {} } },
    mcp: {
      getAITools: () => ({}) as ToolSet,
      listTools: () => [],
      listServers: () => [],
    },
    githubHostedMcp: { listTools: async () => [], callTool },
    resolveRuntimeIdentity: async () => Result.ok(identity),
  } as unknown as McpHost

  const controller = new RuntimeMcpController(host)
  const internals = controller as unknown as {
    activeNativeConnectorAccounts: Map<string, unknown>
    activeGitHubHostedMcpTools: unknown[]
  }
  internals.activeNativeConnectorAccounts.set('github', {
    accountId: '42',
    status: 'connected',
    accountLogin,
  })
  internals.activeGitHubHostedMcpTools = [
    { name: 'list_issues', description: 'hosted', inputSchema: {} },
  ]

  const tools = controller.wrapGetAITools(() => ({}) as ToolSet, undefined)
  const hosted = tools[
    buildMcpAiToolKey('github-mcp', 'list_issues')
  ] as unknown as ExecutableTool
  const native = tools[
    buildMcpAiToolKey('github', 'list_branches')
  ] as unknown as ExecutableTool
  return {
    callTool,
    fetchSpy,
    runHosted: (input: unknown) =>
      hosted.execute(input, { toolCallId: randomUUID(), messages: [] }),
    runNative: (input: unknown) =>
      native.execute(input, { toolCallId: randomUUID(), messages: [] }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('github owner identity gate (#332)', () => {
  it('rejects a hallucinated owner on the hosted surface before calling GitHub', async () => {
    const { runHosted, callTool } = githubToolSurface(ACCOUNT)
    const result = await runHosted({
      owner: 'flowresearch',
      repo: 'garden',
      state: 'open',
    })
    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('flowresearch'),
    })
    expect(result).toMatchObject({
      message: expect.stringContaining(ACCOUNT),
    })
    expect(callTool).not.toHaveBeenCalled()
  })

  it('corrects a case-variant owner to the canonical login on the hosted surface', async () => {
    const { runHosted, callTool } = githubToolSurface(ACCOUNT)
    const input = { owner: 'flow-research', repo: 'garden', state: 'open' }
    await expect(runHosted(input)).resolves.toEqual({ ok: true })
    expect(callTool).toHaveBeenCalledWith('42', 'list_issues', {
      ...input,
      owner: ACCOUNT,
    })
  })

  it('passes the owner through untouched when no canonical login is known', async () => {
    const { runHosted, callTool } = githubToolSurface(undefined)
    const input = { owner: 'anything', repo: 'garden' }
    await expect(runHosted(input)).resolves.toEqual({ ok: true })
    expect(callTool).toHaveBeenCalledWith('42', 'list_issues', input)
  })

  // The native surface shares the gate; a rejection returns before the
  // Effect layer runs, so no mint and no fetch happen.
  it('rejects a hallucinated owner on the native surface before any request', async () => {
    const { runNative, fetchSpy } = githubToolSurface(ACCOUNT)
    const result = await runNative({ owner: 'flowresearch', repo: 'garden' })
    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('is not the connected GitHub account'),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // A matching owner passes the gate and reaches the tool handler; the call
  // then fails locally at the mint because the probe env holds no App
  // credentials, which is exactly how the test proves the gate let it through
  // without touching the network.
  it('lets a matching owner through to the native tool handler', async () => {
    const { runNative, fetchSpy } = githubToolSurface(ACCOUNT)
    const result = await runNative({ owner: ACCOUNT, repo: 'garden' })
    expect(result).toMatchObject({
      message: expect.stringContaining('github.list_branches failed'),
    })
    expect(result).not.toMatchObject({
      message: expect.stringContaining('is not the connected GitHub account'),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
