// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'
import { parseSync } from 'oxc-parser'
import { describe, expect, it, vi } from 'vitest'
import { Result } from 'better-result'
import { agentsSdk } from '@/test/agents-sdk-fixture'

const { Agent, callable } = agentsSdk
const source = await readFile(
  new URL(
    '../../../../../packages/agent-runtime/src/agent-do.ts',
    import.meta.url,
  ),
  'utf8',
)
const parsed = parseSync('agent-do.ts', source)
const threadMethods = [
  'ensureThread',
  'warmThreadRuntime',
  'deleteThread',
  'pauseThread',
  'debugThreadMeta',
  'debugThreadWorkspace',
  'debugThreadSandbox',
  'debugThreadTools',
  'debugThreadPrompt',
  'runThreadFixtureTurn',
  'uploadThreadDocument',
  'readThreadDocumentBytes',
  'readThreadDocumentVersionBytes',
  'listThreadDocumentVersions',
  'readThreadDocumentArtifact',
  'applyThreadDocumentArtifactOperation',
  'subscribeThreadDocumentArtifact',
  'refreshThreadPrompt',
]

// Compile the actual class/decorators while leaving unrelated method dependencies
// uninitialized. Dispatch uses the installed SDK's constructor and onMessage.
async function compileClass(name: string) {
  const declaration = parsed.program.body
    .flatMap((node) =>
      node.type === 'ExportNamedDeclaration' && node.declaration
        ? [node.declaration]
        : [],
    )
    .find((node) => node.type === 'ClassDeclaration' && node.id?.name === name)
  if (!declaration) throw new Error(`Missing class ${name}`)
  const compiled = await transform(
    source.slice(declaration.start, declaration.end),
    { loader: 'ts', target: 'es2022' },
  )
  return new Function(
    'Agent',
    'Think',
    'callable',
    `${compiled.code}; return ${name};`,
  )(Agent, Agent, callable) as { prototype: Record<string, unknown> }
}

const parentClass = await compileClass('AgentDO')
const chatClass = await compileClass('ChatSubAgent')
class DispatchAgent extends Agent {}

function runtime(prototype: Record<string, unknown>) {
  const context = {
    id: { name: 'callability-proof' },
    storage: {
      sql: { exec: () => Object.assign([], { toArray: () => [] }) },
      get: async () => undefined,
    },
    getWebSockets: () => [],
  }
  const agent = Reflect.construct(DispatchAgent, [context, {}]) as InstanceType<
    typeof Agent
  >
  Object.setPrototypeOf(agent, prototype)
  return agent
}

async function dispatch(agent: InstanceType<typeof Agent>, method: string) {
  const sent: string[] = []
  const connection = {
    id: 'browser-proof',
    uri: 'https://garden.test/agents/agent-d-o/parent',
    state: null,
    setState(value: unknown) {
      this.state = value as null
      return this.state
    },
    send: (value: string) => sent.push(value),
  }
  await Reflect.apply(agent.onMessage, agent, [
    connection,
    JSON.stringify({ type: 'rpc', id: method, method, args: ['other-thread'] }),
  ])
  return sent.map(
    (value) =>
      JSON.parse(value) as { type: string; error?: string; result?: unknown },
  )
}

describe('parent thread methods are native RPC only', () => {
  it.each(threadMethods)(
    'rejects browser dispatch to %s before invocation',
    async (method) => {
      const agent = runtime(parentClass.prototype)
      expect(typeof parentClass.prototype[method]).toBe('function')
      const entered = vi.fn(() => {
        throw new Error('thread body entered')
      })
      Object.defineProperty(agent, 'requireThreadAccess', { value: entered })
      const replies = await dispatch(agent, method)
      expect(replies).toContainEqual(
        expect.objectContaining({
          type: 'rpc',
          error: `Method ${method} is not callable`,
        }),
      )
      expect(entered).not.toHaveBeenCalled()
    },
  )

  it('retains nonchat browser-callable dispatch', async () => {
    const agent = runtime(parentClass.prototype)
    const entered = vi.fn(async () => {
      throw new Error('nonchat body entered')
    })
    Object.defineProperty(agent, 'requireIssueAccess', { value: entered })
    expect(await dispatch(agent, 'startIssueRunWorkflow')).toContainEqual(
      expect.objectContaining({ error: 'nonchat body entered' }),
    )
    expect(entered).toHaveBeenCalledOnce()
  })

  it('warms the chat facet through its existing callable method', async () => {
    const agent = runtime(chatClass.prototype)
    const ensureLoaded = vi.fn(async () => Result.ok(undefined))
    Object.defineProperty(agent, 'mcpConnectionPreparer', {
      value: { ensureLoaded },
    })
    expect(await dispatch(agent, 'warmRuntime')).toContainEqual(
      expect.objectContaining({ result: { ok: true } }),
    )
    expect(ensureLoaded).toHaveBeenCalledWith('client-prewarm')
  })
})
