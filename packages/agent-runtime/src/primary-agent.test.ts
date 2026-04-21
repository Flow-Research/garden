import { describe, expect, it } from 'vitest'

import { bindSessionRouting } from './session-routing'

function createChatRequest(sessionId: string) {
  return JSON.stringify({
    type: 'cf_agent_use_chat_request',
    init: { body: JSON.stringify({ sessionId }) },
  })
}

async function flushMicrotasks(iterations = 5) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}

function createAgentForRoutingTest() {
  const agent: {
    name: string
    onMessage: (connection: unknown, message: unknown) => Promise<unknown>
    onRequest: (request: Request) => Promise<Response>
    selectSession: (sessionId: string) => void
    sessionTurnQueue: Promise<void>
  } = {
    name: 'test-agent',
    onMessage: async () => undefined,
    onRequest: async () => new Response('ok'),
    selectSession: () => undefined,
    sessionTurnQueue: Promise.resolve(),
  }

  return agent
}

describe('PrimaryAgent session routing', () => {
  it('serializes concurrent chat messages across sessions', async () => {
    const agent = createAgentForRoutingTest()
    const selectedSessions: string[] = []
    const startedSessions: string[] = []
    const releases = new Map<string, () => void>()
    let concurrentHandlers = 0
    let maxConcurrentHandlers = 0

    agent.selectSession = (sessionId) => {
      selectedSessions.push(sessionId)
    }

    agent.onRequest = async () => new Response('ok')
    agent.onMessage = async (_connection, message) => {
      const parsed = JSON.parse(String(message)) as {
        init: { body: string }
      }
      const { sessionId } = JSON.parse(parsed.init.body) as { sessionId: string }
      startedSessions.push(sessionId)
      concurrentHandlers += 1
      maxConcurrentHandlers = Math.max(maxConcurrentHandlers, concurrentHandlers)

      await new Promise<void>((resolve) => {
        releases.set(sessionId, () => {
          concurrentHandlers -= 1
          resolve()
        })
      })
    }

    bindSessionRouting(agent)

    const firstMessage = agent.onMessage(null, createChatRequest('session-a'))
    await flushMicrotasks()

    const secondMessage = agent.onMessage(null, createChatRequest('session-b'))
    await flushMicrotasks()

    expect(selectedSessions).toEqual(['session-a'])
    expect(startedSessions).toEqual(['session-a'])
    expect(maxConcurrentHandlers).toBe(1)

    releases.get('session-a')?.()
    await flushMicrotasks()

    expect(selectedSessions).toEqual(['session-a', 'session-b'])
    expect(startedSessions).toEqual(['session-a', 'session-b'])
    expect(maxConcurrentHandlers).toBe(1)

    releases.get('session-b')?.()

    await firstMessage
    await secondMessage
  })

  it('keeps session-bound requests behind the same lock', async () => {
    const agent = createAgentForRoutingTest()
    const selectedSessions: string[] = []
    const requestStarts: string[] = []
    let releaseFirstRequest: (() => void) | undefined

    agent.selectSession = (sessionId) => {
      selectedSessions.push(sessionId)
    }

    agent.onMessage = async () => undefined
    agent.onRequest = async (request) => {
      const sessionId =
        new URL(request.url).searchParams.get('sessionId') ?? 'missing'
      requestStarts.push(sessionId)

      if (sessionId === 'session-a') {
        await new Promise<void>((resolve) => {
          releaseFirstRequest = resolve
        })
      }

      return new Response(sessionId)
    }

    bindSessionRouting(agent)

    const firstRequest = agent.onRequest(
      new Request('https://example.test/get-messages?sessionId=session-a'),
    )
    await flushMicrotasks()

    const secondRequest = agent.onRequest(
      new Request('https://example.test/get-messages?sessionId=session-b'),
    )
    await flushMicrotasks()

    expect(selectedSessions).toEqual(['session-a'])
    expect(requestStarts).toEqual(['session-a'])

    const release = releaseFirstRequest
    if (!release) {
      throw new Error('First request did not start')
    }
    release()
    await flushMicrotasks()

    expect(selectedSessions).toEqual(['session-a', 'session-b'])
    expect(requestStarts).toEqual(['session-a', 'session-b'])

    await firstRequest
    await secondRequest
  })
})
