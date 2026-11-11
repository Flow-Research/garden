import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolSet } from 'ai'
import { Result } from 'better-result'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import { clearGitHubInstallationTokenCache } from '@garden/connectors/github/installation-auth'
import {
  RuntimeMcpController,
  type McpHost,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'

const ACCOUNT = 'Flow-Research'
const INSTALLATION_ID = '51337001'
const MINTED_TOKEN = 'ghs_e2e'

/**
 * A real RSA key so the mint path signs a real GitHub App JWT. GitHub is the
 * only stubbed boundary: the fetch dispatcher answers the token mint and the
 * repository read, so the test runs the production path from tool assembly
 * through the owner gate, JWT signing, REST client, and response decoding.
 */
const appPrivateKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey

type GithubCall = {
  method: string
  path: string
  authorization: string | null
}

type GithubStubOptions = { branchesStatus?: number }

/**
 * Effect's `FetchHttpClient` captures the platform `fetch` reference once, so
 * a per-test `vi.stubGlobal` would leave the REST client talking to the first
 * stub it ever saw. Install one dispatcher before the modules load and point
 * it at a per-test handler instead.
 */
const githubHttp = vi.hoisted(() => {
  const originalFetch = globalThis.fetch
  const state: {
    calls: Array<{ method: string; path: string; authorization: string | null }>
    handler:
      | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)
      | null
  } = { calls: [], handler: null }

  const dispatcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      input instanceof URL
        ? input
        : new URL(typeof input === 'string' ? input : input.url)
    const headers = new Headers(init?.headers)
    state.calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      authorization: headers.get('authorization'),
    })
    if (!state.handler) {
      throw new Error(`Unexpected GitHub request: ${url.pathname}`)
    }
    return state.handler(input, init)
  }) as typeof globalThis.fetch

  globalThis.fetch = dispatcher
  return { originalFetch, state }
})

/**
 * Answers the two GitHub endpoints this scenario needs and records every call
 * so the test can assert on the exact path and credential that crossed the
 * network boundary. `branchesStatus: 404` simulates a wrong repository name.
 */
function stubGithub(options: GithubStubOptions = {}): GithubCall[] {
  githubHttp.state.calls = []
  githubHttp.state.handler = async (input) => {
    const url =
      input instanceof URL
        ? input
        : new URL(typeof input === 'string' ? input : input.url)
    if (url.pathname === `/app/installations/${INSTALLATION_ID}/access_tokens`) {
      return new Response(
        JSON.stringify({
          token: MINTED_TOKEN,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.pathname === `/repos/${ACCOUNT}/garden/branches`) {
      if (options.branchesStatus === 404) {
        return new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify([{ name: 'dev', commit: { sha: 'abc123' } }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ message: 'Not Found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
  return githubHttp.state.calls
}

type ExecutableTool = {
  execute: (input: unknown, options: unknown) => Promise<unknown>
}

/**
 * Builds the real GitHub AI tools for a workspace whose GitHub App is
 * installed on `ACCOUNT`, with the private key and install id wired into the
 * host env exactly as production does.
 */
function githubToolSurface() {
  const callHostedTool = vi.fn(async () => ({ ok: true }))
  const identity: ThreadRuntimeIdentity = {
    threadId: randomUUID(),
    workspaceId: randomUUID(),
    userId: randomUUID(),
    agentId: randomUUID(),
  }
  const host = {
    name: 'github-owner-e2e',
    env: {
      GITHUB_APP_ID: '151515',
      GITHUB_CLIENT_ID: 'Iv1.e2e',
      GITHUB_APP_PRIVATE_KEY: appPrivateKey,
    },
    ctx: { storage: { sql: {} } },
    mcp: {
      getAITools: () => ({}) as ToolSet,
      listTools: () => [],
      listServers: () => [],
    },
    githubHostedMcp: { listTools: async () => [], callTool: callHostedTool },
    resolveRuntimeIdentity: async () => Result.ok(identity),
  } as unknown as McpHost

  const controller = new RuntimeMcpController(host)
  const internals = controller as unknown as {
    activeNativeConnectorAccounts: Map<string, unknown>
    activeGitHubHostedMcpTools: unknown[]
  }
  internals.activeNativeConnectorAccounts.set('github', {
    accountId: INSTALLATION_ID,
    accountLogin: ACCOUNT,
    status: 'connected',
  })
  internals.activeGitHubHostedMcpTools = [
    { name: 'list_issues', description: 'hosted', inputSchema: {} },
  ]

  const tools = controller.wrapGetAITools(() => ({}) as ToolSet, undefined)
  const native = tools[
    buildMcpAiToolKey('github', 'list_branches')
  ] as unknown as ExecutableTool
  const hosted = tools[
    buildMcpAiToolKey('github-mcp', 'list_issues')
  ] as unknown as ExecutableTool
  return {
    callHostedTool,
    runNative: (input: unknown) =>
      native.execute(input, { toolCallId: randomUUID(), messages: [] }),
    runHosted: (input: unknown) =>
      hosted.execute(input, { toolCallId: randomUUID(), messages: [] }),
  }
}

beforeEach(() => {
  clearGitHubInstallationTokenCache()
})

afterEach(() => {
  githubHttp.state.handler = null
})

afterAll(() => {
  globalThis.fetch = githubHttp.originalFetch
})

describe('GitHub owner gate end to end (#332)', () => {
  // The incident: the model called the repo as `flowresearch/garden`. The
  // call must be refused before a token is even minted.
  it('refuses a hallucinated owner without minting a token or calling GitHub', async () => {
    const calls = stubGithub()
    const { runNative } = githubToolSurface()

    const result = await runNative({ owner: 'flowresearch', repo: 'garden' })

    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining(ACCOUNT),
    })
    expect(calls).toEqual([])
  })

  it('corrects a re-cased owner and reads the repository with the canonical path', async () => {
    const calls = stubGithub()
    const { runNative } = githubToolSurface()

    const result = await runNative({ owner: 'flow-research', repo: 'garden' })

    expect(result).toEqual([{ name: 'dev', commit: { sha: 'abc123' } }])
    expect(calls.map((call) => call.path)).toEqual([
      `/app/installations/${INSTALLATION_ID}/access_tokens`,
      `/repos/${ACCOUNT}/garden/branches`,
    ])
    // The minted installation token is what authenticates the repository read.
    expect(calls[0]?.authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/)
    expect(calls[1]?.authorization).toBe(`Bearer ${MINTED_TOKEN}`)
  })

  it('trims a padded owner before the request leaves the worker', async () => {
    const calls = stubGithub()
    const { runNative } = githubToolSurface()

    await expect(
      runNative({ owner: ` ${ACCOUNT} `, repo: 'garden' }),
    ).resolves.toEqual([{ name: 'dev', commit: { sha: 'abc123' } }])
    expect(calls.at(-1)?.path).toBe(`/repos/${ACCOUNT}/garden/branches`)
  })

  // Wrong repository name (right owner) still 404s at GitHub; the tool result
  // must carry the retry hint through the real error classification.
  it('returns the list_repositories hint when the repository name 404s', async () => {
    const calls = stubGithub({ branchesStatus: 404 })
    const { runNative } = githubToolSurface()

    const result = await runNative({ owner: ACCOUNT, repo: 'garden-cli' })

    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('list_repositories'),
    })
    expect(calls.at(-1)?.path).toBe(`/repos/${ACCOUNT}/garden-cli/branches`)
  })

  it('refuses a hallucinated owner on the hosted surface too', async () => {
    const calls = stubGithub()
    const { runHosted, callHostedTool } = githubToolSurface()

    const result = await runHosted({ owner: 'flowresearch', repo: 'garden' })

    expect(result).toMatchObject({ error: true })
    expect(callHostedTool).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })
})
