import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentClient } from 'agents/client'
import { chatFacetPath } from '@garden/client'
import { createNativeChatSocket } from './native-chat-socket'

const clients: AgentClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  vi.unstubAllGlobals()
})

function fixture() {
  const connections: {
    url: string
    options?: { headers: Record<string, string> }
    sent: unknown[]
    readyState: number
  }[] = []
  class Socket extends EventTarget {
    static OPEN = 1
    readyState = 1
    sent: unknown[] = []
    constructor(
      public url: string,
      _protocols?: string | string[],
      public options?: { headers: Record<string, string> },
    ) {
      super()
      connections.push(this)
    }
    send(value: unknown) {
      this.sent.push(value)
    }
    close() {
      this.readyState = 3
      this.dispatchEvent(new Event('close'))
    }
  }
  vi.stubGlobal('WebSocket', Socket)
  let cookie = 'session=private'
  const NativeSocket = createNativeChatSocket(
    'https://garden.test',
    '/agents/agent-d-o/host/sub/chat-sub-agent/thread',
    () => cookie,
  )
  return {
    NativeSocket,
    connections,
    cookie: (value: string) => {
      cookie = value
    },
  }
}

describe('native chat credential boundary', () => {
  it('adds the current cookie and exact native origin only to the selected facet', () => {
    const app = fixture()
    new app.NativeSocket(
      'wss://garden.test/agents/agent-d-o/host/sub/chat-sub-agent/thread?_pk=local-client',
    )
    expect(app.connections[0]?.options).toEqual({
      headers: { Cookie: 'session=private', Origin: 'garden-mobile://' },
    })
    app.cookie('session=renewed')
    new app.NativeSocket(
      'wss://garden.test/agents/agent-d-o/host/sub/chat-sub-agent/thread',
    )
    expect(app.connections[1]?.options?.headers.Cookie).toBe('session=renewed')
  })

  it.each([
    'wss://other.test/agents/agent-d-o/host/sub/chat-sub-agent/thread',
    'ws://garden.test/agents/agent-d-o/host/sub/chat-sub-agent/thread',
    'wss://garden.test/agents/agent-d-o/host/sub/chat-sub-agent/other',
    'wss://alice:password@garden.test/agents/agent-d-o/host/sub/chat-sub-agent/thread',
    'wss://garden.test/agents/agent-d-o/host/sub/chat-sub-agent/thread?cookie=secret',
  ])(
    'refuses unsafe targets before constructing a credential-bearing connection: %s',
    (url) => {
      const app = fixture()
      expect(() => new app.NativeSocket(url)).toThrow(
        'Refused a chat connection',
      )
      expect(app.connections).toHaveLength(0)
    },
  )

  it('refuses missing credentials and closed-socket sends without queueing', () => {
    const app = fixture()
    const socket = new app.NativeSocket(
      'wss://garden.test/agents/agent-d-o/host/sub/chat-sub-agent/thread',
    )
    const connection = app.connections[0]
    if (!connection) throw new Error('Missing test socket')
    connection.readyState = 3
    expect(() => socket.send('must not replay')).toThrow('Nothing was queued')
    expect(connection.sent).toEqual([])
    app.cookie('')
    expect(
      () =>
        new app.NativeSocket(
          'wss://garden.test/agents/agent-d-o/host/sub/chat-sub-agent/thread',
        ),
    ).toThrow('current sign-in')
  })

  it('accepts the real SDK URL for an encoded host name without weakening the path guard', async () => {
    const app = fixture()
    const target = {
      id: '10000000-0000-4000-8000-000000000001',
      workspaceId: 'workspace',
      ownerUserId: 'alice',
      title: 'Chat',
      hostName: 'host:instance',
      runtime_kind: 'chat' as const,
      runtime_key: '10000000-0000-4000-8000-000000000001',
    }
    const Socket = createNativeChatSocket(
      'https://garden.test',
      chatFacetPath(target),
      () => 'session=private',
    )
    const client = new AgentClient({
      agent: 'ChatSubAgent',
      name: target.runtime_key,
      host: 'garden.test',
      protocol: 'wss',
      basePath: chatFacetPath(target).slice(1),
      WebSocket: Socket,
      maxEnqueuedMessages: 0,
      maxRetries: 0,
    })
    clients.push(client)
    await vi.waitFor(() => expect(app.connections).toHaveLength(1))
    expect(new URL(app.connections[0]?.url ?? '').pathname).toBe(
      chatFacetPath(target),
    )
    expect(app.connections[0]?.options?.headers.Cookie).toBe('session=private')
  })
})
