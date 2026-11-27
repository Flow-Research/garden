import { generateKeyPairSync, randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
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
 * repository calls, so the test runs the production path from tool assembly
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

type GithubStubOptions = {
  branchesStatus?: number
  canonicalAccount?: string
}

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
 * Answers the GitHub endpoints this scenario needs and records every call so
 * the test can assert on the exact path and credential that crossed the
 * network boundary. `branchesStatus: 404` simulates a wrong repository name.
 */
function stubGithub(options: GithubStubOptions = {}): GithubCall[] {
  githubHttp.state.calls = []
  githubHttp.state.handler = async (input, init) => {
    const account = options.canonicalAccount ?? ACCOUNT
    const url =
      input instanceof URL
        ? input
        : new URL(typeof input === 'string' ? input : input.url)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url.pathname === `/app/installations/${INSTALLATION_ID}`) {
      return json({ account: { login: account } })
    }
    if (
      url.pathname === `/app/installations/${INSTALLATION_ID}/access_tokens`
    ) {
      return json(
        {
          token: MINTED_TOKEN,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        201,
      )
    }
    if (url.pathname === `/repos/${ACCOUNT}/garden/branches`) {
      if (options.branchesStatus === 404) {
        return json({ message: 'Not Found' }, 404)
      }
      return json([{ name: 'dev', commit: { sha: 'abc123' } }])
    }
    if (url.pathname === '/repos/cloudflare/agents/branches') {
      return json([{ name: 'main', commit: { sha: 'def456' } }])
    }
    if (
      url.pathname === '/repos/cloudflare/agents/forks' &&
      init?.method === 'POST'
    ) {
      return json({ full_name: `${account}/agents` }, 202)
    }
    if (
      url.pathname === `/repos/${account}/garden/issues` &&
      init?.method === 'POST'
    ) {
      return json(
        {
          number: 7,
          html_url: `https://github.com/${account}/garden/issues/7`,
        },
        201,
      )
    }
    return json({ message: 'Not Found' }, 404)
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
  const host: McpHost = {
    name: 'github-owner-e2e',
    env: {
      BETTER_AUTH_SECRET: '',
      BETTER_AUTH_URL: 'http://localhost:3000',
      HYPERDRIVE: {
        connectionString: '',
      } as McpHost['env']['HYPERDRIVE'],
      GITHUB_APP_ID: '151515',
      GITHUB_CLIENT_ID: 'Iv1.e2e',
      GITHUB_APP_PRIVATE_KEY: appPrivateKey,
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
    githubHostedMcp: { listTools: async () => [], callTool: callHostedTool },
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
    accountId: INSTALLATION_ID,
    accountLogin: ACCOUNT,
    status: 'connected',
  })
  Reflect.set(controller, 'activeGitHubHostedMcpTools', [
    { name: 'list_issues', description: 'hosted', inputSchema: {} },
    { name: 'issue_write', description: 'hosted', inputSchema: {} },
  ])

  const tools = controller.wrapGetAITools(() => ({}) as ToolSet, undefined)
  const tool = (connectorId: string, name: string) =>
    tools[buildMcpAiToolKey(connectorId, name)] as ExecutableTool | undefined
  const run = (
    selected: ExecutableTool | undefined,
    input: unknown,
  ): Promise<unknown> => {
    if (!selected) throw new Error('Expected tool to be assembled')
    return selected.execute(input, { toolCallId: randomUUID(), messages: [] })
  }
  return {
    callHostedTool,
    runNativeRead: (input: unknown) =>
      run(tool('github', 'list_branches'), input),
    runNativeWrite: (input: unknown) =>
      run(tool('github', 'issue_write'), input),
    runNativeFork: (input: unknown) =>
      run(tool('github', 'fork_repository'), input),
    runHostedRead: (input: unknown) =>
      run(tool('github-mcp', 'list_issues'), input),
    runHostedWrite: (input: unknown) =>
      run(tool('github-mcp', 'issue_write'), input),
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
  // The #332 owner guess, now on a write: it must be refused before a token
  // is even minted. The read that originally hit the 404 is allowed through.
  it('refuses a hallucinated owner on a write without minting or calling GitHub', async () => {
    const calls = stubGithub()
    const { runNativeWrite } = githubToolSurface()

    const result = await runNativeWrite({
      owner: 'flowresearch',
      repo: 'garden',
      title: 'Fix',
    })

    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining(ACCOUNT),
    })
    expect(calls.map((call) => call.path)).toEqual([
      `/app/installations/${INSTALLATION_ID}`,
    ])
  })

  it('allows a renamed installation owner after one canonical identity lookup', async () => {
    const renamed = 'Flow-Research-New'
    const calls = stubGithub({ canonicalAccount: renamed })
    const { runNativeWrite } = githubToolSurface()
    await expect(
      runNativeWrite({ owner: renamed, repo: 'garden', title: 'Fix' }),
    ).resolves.toMatchObject({ number: 7 })
    expect(calls.map((call) => call.path)).toEqual([
      `/app/installations/${INSTALLATION_ID}`,
      `/app/installations/${INSTALLATION_ID}/access_tokens`,
      `/repos/${renamed}/garden/issues`,
    ])
  })

  it('blocks the write when the installation owner cannot be confirmed', async () => {
    const calls = stubGithub()
    githubHttp.state.handler = async () =>
      new Response(JSON.stringify({ message: 'Unavailable' }), { status: 503 })
    const { runNativeWrite } = githubToolSurface()
    await expect(
      runNativeWrite({
        owner: 'Renamed-Research',
        repo: 'garden',
        title: 'Fix',
      }),
    ).resolves.toMatchObject({
      error: true,
      message: expect.stringContaining('Flow-Research'),
    })
    expect(calls.map((call) => call.path)).toEqual([
      `/app/installations/${INSTALLATION_ID}`,
    ])
  })

  it('forks an external repository into the connected organization', async () => {
    const calls = stubGithub()
    const { runNativeFork } = githubToolSurface()

    await expect(
      runNativeFork({
        owner: 'cloudflare',
        repo: 'agents',
        organization: ACCOUNT,
      }),
    ).resolves.toEqual({ full_name: `${ACCOUNT}/agents` })
    expect(calls.map((call) => call.path)).toEqual([
      `/app/installations/${INSTALLATION_ID}/access_tokens`,
      '/repos/cloudflare/agents/forks',
    ])
  })

  it('corrects a re-cased owner and reads the repository with the canonical path', async () => {
    const calls = stubGithub()
    const { runNativeRead } = githubToolSurface()

    const result = await runNativeRead({
      owner: 'flow-research',
      repo: 'garden',
    })

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
    const { runNativeRead } = githubToolSurface()

    await expect(
      runNativeRead({ owner: ` ${ACCOUNT} `, repo: 'garden' }),
    ).resolves.toEqual([{ name: 'dev', commit: { sha: 'abc123' } }])
    expect(calls.at(-1)?.path).toBe(`/repos/${ACCOUNT}/garden/branches`)
  })

  // Reads can't change GitHub state, so a public repo outside the install
  // account is useful context: the owner must reach GitHub unchanged.
  it('reads a repository outside the connected account unchanged', async () => {
    const calls = stubGithub()
    const { runNativeRead } = githubToolSurface()

    await expect(
      runNativeRead({ owner: 'cloudflare', repo: 'agents' }),
    ).resolves.toEqual([{ name: 'main', commit: { sha: 'def456' } }])
    expect(calls.at(-1)?.path).toBe('/repos/cloudflare/agents/branches')
  })

  // A branch 404 cannot identify whether the repository or branch is absent.
  it('does not redirect a branch 404 to another repository', async () => {
    const calls = stubGithub({ branchesStatus: 404 })
    const { runNativeRead } = githubToolSurface()

    const result = await runNativeRead({ owner: ACCOUNT, repo: 'garden-cli' })

    expect(result).toMatchObject({
      error: true,
      message: expect.not.stringContaining('list_repositories'),
    })
    expect(calls.at(-1)?.path).toBe(`/repos/${ACCOUNT}/garden-cli/branches`)
  })

  it('refuses a hallucinated owner on the hosted write too', async () => {
    const calls = stubGithub()
    const { runHostedWrite, callHostedTool } = githubToolSurface()

    const result = await runHostedWrite({
      owner: 'flowresearch',
      repo: 'garden',
      title: 'Fix',
    })

    expect(result).toMatchObject({ error: true })
    expect(callHostedTool).not.toHaveBeenCalled()
    expect(calls.map((call) => call.path)).toEqual([
      `/app/installations/${INSTALLATION_ID}`,
    ])
  })

  it('corrects a re-cased owner on a native write before POSTing', async () => {
    const calls = stubGithub()
    const { runNativeWrite } = githubToolSurface()

    const result = await runNativeWrite({
      owner: 'flow-research',
      repo: 'garden',
      title: 'Fix',
    })

    expect(result).toMatchObject({ number: 7 })
    expect(calls.at(-1)?.path).toBe(`/repos/${ACCOUNT}/garden/issues`)
    expect(calls.at(-1)?.method).toBe('POST')
  })
})
