import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentChatSession } from './use-agent-chat-sessions'

/**
 * Stands in for the PartySocket that `useAgent` returns. The real
 * `useAgentChat` from `@cloudflare/ai-chat/react` drives it, so the test
 * exercises the SDK's own message handling rather than a mock of it.
 */
class FakeAgentSocket extends EventTarget {
  agent = 'agent-d-o'
  name = 'host-1'
  sent: string[] = []
  onMessage: ((event: MessageEvent) => void) | undefined
  send(data: string) {
    this.sent.push(data)
  }
  call = vi.fn(async () => ({ ok: true }))
  getHttpUrl() {
    return 'http://localhost/agents/agent-d-o/host-1'
  }
  /** Delivers one server frame the way PartySocket does. */
  deliver(payload: unknown) {
    const event = new MessageEvent('message', {
      data: JSON.stringify(payload),
    })
    this.onMessage?.(event)
    this.dispatchEvent(event)
  }
}

let sockets: FakeAgentSocket[] = []

vi.mock('agents/react', () => ({
  useAgent: (options: {
    sub?: unknown
    onMessage?: (event: MessageEvent) => void
  }) => {
    const index = options.sub ? 1 : 0
    sockets[index] ??= new FakeAgentSocket()
    const socket = sockets[index]
    socket.onMessage = options.onMessage
    return socket
  },
}))

const { useChatRuntimeConnection } = await import('./chat-runtime-provider')

const session = {
  id: 'thread-1',
  hostName: 'host-1',
  runtime_key: 'thread-1',
} as unknown as AgentChatSession

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function userTexts(messages: Array<{ role: string; parts: unknown[] }>) {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        typeof part === 'object' &&
        part !== null &&
        'text' in part &&
        typeof part.text === 'string'
          ? [part.text]
          : [],
      ),
    )
}

describe('useChatRuntimeConnection first send', () => {
  beforeEach(() => {
    sockets = []
  })

  it('keeps the first message when the connect history lands after an early send', async () => {
    const { result } = renderHook(
      () =>
        useChatRuntimeConnection({
          session,
          updateSessionPreview: vi.fn(),
        }),
      { wrapper },
    )

    // The person sends before the socket has delivered its connect frames.
    // In the app the socket takes hundreds of milliseconds to open, so the
    // send has long settled when the history lands.
    act(() => {
      void result.current.sendMessage({ text: 'hello there' })
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    // A brand-new thread's connect history is empty, and the server sends it
    // before it reads the queued chat request.
    act(() => {
      sockets[1]!.deliver({ type: 'cf_agent_chat_messages', messages: [] })
    })

    await waitFor(() => {
      expect(userTexts(result.current.messages)).toEqual(['hello there'])
    })
  })

  it('sends the chat request only after the connect history has arrived', async () => {
    const { result } = renderHook(
      () =>
        useChatRuntimeConnection({
          session,
          updateSessionPreview: vi.fn(),
        }),
      { wrapper },
    )
    const chatSocket = sockets[1]!
    const chatRequests = () =>
      chatSocket.sent.filter((frame) =>
        frame.includes('"cf_agent_use_chat_request"'),
      )

    act(() => {
      void result.current.sendMessage({ text: 'hello there' })
    })
    // Give the send every chance to reach the socket before history arrives.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(chatRequests()).toHaveLength(0)

    act(() => {
      chatSocket.deliver({ type: 'cf_agent_chat_messages', messages: [] })
    })

    await waitFor(() => {
      expect(chatRequests()).toHaveLength(1)
    })
  })
})
