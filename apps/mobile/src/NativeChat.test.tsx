// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Result } from 'better-result'
import { createMobileController, type MobilePorts } from './controller'
import { NativeChat } from './NativeChat'

const thread = {
  id: '10000000-0000-4000-8000-000000000001',
  runtime_key: '10000000-0000-4000-8000-000000000001',
  runtime_kind: 'chat' as const,
  workspaceId: 'workspace',
  ownerUserId: 'alice',
  title: 'Owned chat',
  hostName: 'host',
}

/** DOM hosts only replace native rendering. The real SDK handles every chat frame. */
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    title,
    onPress,
    disabled,
  }: {
    title: string
    onPress: () => void
    disabled: boolean
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {title}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
  }: {
    value: string
    onChangeText: (value: string) => void
    accessibilityLabel: string
  }) => (
    <textarea
      aria-label={accessibilityLabel}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}))

class TestSocket extends EventTarget {
  agent = 'ChatSubAgent'
  name = thread.id
  path = [
    { agent: 'AgentDO', name: 'host' },
    { agent: 'ChatSubAgent', name: thread.id },
  ]
  OPEN = 1
  readyState = 0
  sent: string[] = []
  options: {
    onOpen?: () => void
    onClose?: (event: CloseEvent) => void
    onMessage?: (event: MessageEvent) => void
  } = {}
  getHttpUrl() {
    return `https://garden.test/agents/agent-d-o/host/sub/chat-sub-agent/${thread.id}`
  }
  send(value: string) {
    if (this.readyState !== 1) return false
    this.sent.push(value)
    return true
  }
  open() {
    this.readyState = 1
    this.options.onOpen?.()
  }
  close(code = 1000) {
    this.readyState = 3
    this.options.onClose?.(new CloseEvent('close', { code }))
    this.dispatchEvent(new Event('close'))
  }
  deliver(payload: unknown) {
    const event = new MessageEvent('message', { data: JSON.stringify(payload) })
    this.options.onMessage?.(event)
    this.dispatchEvent(event)
  }
  requests() {
    return this.sent
      .map((raw) => JSON.parse(raw))
      .filter((frame) => frame.type === 'cf_agent_use_chat_request')
  }
}

let socket = new TestSocket()
let lastOptions: Record<string, unknown> = {}
vi.mock('agents/react', () => ({
  useAgent: (options: TestSocket['options']) => {
    socket.options = options
    lastOptions = options
    return socket
  },
}))

async function fixture() {
  let account = 'alice'
  const ports: MobilePorts = {
    auth: () => ({
      session: async () => Result.ok(account),
      signIn: async () => Result.ok(account),
      signOut: async () => {},
      sessionExpiresAt: () => 100_000,
      createChatSocket: () => WebSocket,
      fetch: async (input) => {
        const path = new URL(String(input)).pathname
        return Response.json(
          path === '/api/workspaces'
            ? [{ id: 'workspace', name: 'Workspace' }]
            : path === '/api/issues'
              ? { issues: [] }
              : path === '/api/chat/threads'
                ? [thread]
                : [],
        )
      },
    }),
    createRequestId: () => crypto.randomUUID(),
    now: () => 1234,
    scheduleExpiry: () => () => {},
    readCache: async () => null,
    writeCache: async () => {},
    clearCache: async () => {},
    readDraft: async () => null,
    writeDraft: async () => {},
    clearDraft: async () => {},
  }
  const controller = createMobileController(ports)
  await controller.connect('https://garden.test')
  await controller.selectWorkspace('workspace')
  await controller.selectThread(thread.id)
  render(
    <NativeChat
      controller={controller}
      thread={thread}
      origin="https://garden.test"
    />,
  )
  return {
    controller,
    account: (value: string) => {
      account = value
    },
  }
}

beforeEach(() => {
  socket = new TestSocket()
})
afterEach(() => cleanup())

function connectHistory() {
  act(() => {
    socket.open()
    socket.deliver({ type: 'cf_agent_chat_messages', messages: [] })
    socket.deliver({ type: 'cf_agent_stream_resume_none' })
  })
}

describe('native chat through the actual Cloudflare SDK', () => {
  it('hides private chat and clears the active workspace after an explicit policy close', async () => {
    const app = await fixture()
    connectHistory()
    act(() => socket.close(1008))
    await waitFor(() =>
      expect(app.controller.getSnapshot().phase).toBe('blocked'),
    )
    expect(app.controller.getSnapshot().chatDraft).toBeNull()
    expect(screen.queryByText(thread.title)).toBeNull()
  })

  it('waits for connect history, then renders the actual SDK text stream', async () => {
    await fixture()
    fireEvent.change(screen.getByLabelText('Chat message'), {
      target: { value: 'Hello Garden' },
    })
    fireEvent.click(screen.getByText('Send chat message'))
    expect(socket.requests()).toHaveLength(0)
    connectHistory()
    fireEvent.click(screen.getByText('Send chat message'))
    await waitFor(() => expect(socket.requests()).toHaveLength(1))
    const request = socket.requests()[0]
    expect(JSON.parse(request.init.body).messages[0].parts).toContainEqual({
      type: 'text',
      text: 'Hello Garden',
    })
    act(() => {
      for (const chunk of [
        { type: 'start', messageId: 'reply' },
        { type: 'text-start', id: 'text' },
        { type: 'text-delta', id: 'text', delta: 'Actual SDK reply' },
        { type: 'text-end', id: 'text' },
        { type: 'finish', finishReason: 'stop' },
      ])
        socket.deliver({
          type: 'cf_agent_use_chat_response',
          id: request.id,
          body: JSON.stringify(chunk),
        })
      socket.deliver({
        type: 'cf_agent_use_chat_response',
        id: request.id,
        done: true,
      })
    })
    await waitFor(() =>
      expect(screen.getByText('Actual SDK reply')).toBeDefined(),
    )
    expect(lastOptions).toMatchObject({
      basePath: 'agents/agent-d-o/host',
      maxEnqueuedMessages: 0,
      transferEnqueuedMessages: false,
    })
  })

  it('refuses a changed account before sending any consequential SDK frame', async () => {
    const app = await fixture()
    connectHistory()
    app.account('bob')
    fireEvent.change(screen.getByLabelText('Chat message'), {
      target: { value: 'Private request' },
    })
    fireEvent.click(screen.getByText('Send chat message'))
    await waitFor(() =>
      expect(app.controller.getSnapshot().phase).toBe('blocked'),
    )
    expect(socket.requests()).toHaveLength(0)
  })

  it('disconnects locally without sending a cancellation or replaying an unsent draft', async () => {
    await fixture()
    connectHistory()
    fireEvent.change(screen.getByLabelText('Chat message'), {
      target: { value: 'Unsent local draft' },
    })
    act(() => socket.close())
    fireEvent.click(screen.getByText('Send chat message'))
    cleanup()
    expect(socket.requests()).toHaveLength(0)
    expect(
      socket.sent.some((value) =>
        value.includes('cf_agent_chat_request_cancel'),
      ),
    ).toBe(false)
  })

  it('keeps an interrupted active reply unconfirmed and never treats disconnect as cancellation', async () => {
    await fixture()
    connectHistory()
    fireEvent.change(screen.getByLabelText('Chat message'), {
      target: { value: 'Inspect partial delivery' },
    })
    fireEvent.click(screen.getByText('Send chat message'))
    await waitFor(() => expect(socket.requests()).toHaveLength(1))
    const request = socket.requests()[0]
    act(() => {
      socket.deliver({
        type: 'cf_agent_use_chat_response',
        id: request.id,
        body: JSON.stringify({ type: 'start', messageId: 'partial' }),
      })
      socket.close()
    })
    await waitFor(() =>
      expect(
        screen.getByText(
          'Delivery is unconfirmed. Reload history and inspect it before another send.',
        ),
      ).toBeDefined(),
    )
    expect(
      screen.queryByText(
        'Reply completed. Review the conversation before sending again.',
      ),
    ).toBeNull()
    expect(
      socket.sent.some((value) =>
        value.includes('cf_agent_chat_request_cancel'),
      ),
    ).toBe(false)
  })
})
