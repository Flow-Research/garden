import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { AgentClient } from 'agents/client'
import { Result } from 'better-result'
import WebSocket from 'ws'
import { z } from 'zod'
import { GardenEvalError } from './errors.ts'

const connectSyncFrameSchema = z.object({
  type: z.enum(['cf_agent_chat_messages', 'cf_agent_stream_resuming']),
})

const chatResponseFrameSchema = z.object({
  type: z.literal('cf_agent_use_chat_response'),
  id: z.string().min(1),
  body: z.string(),
  done: z.boolean(),
  error: z.boolean().optional(),
})

const textDeltaSchema = z.object({
  type: z.literal('text-delta'),
  delta: z.string(),
})

type ChatSocketInput = {
  baseUrl: string
  hostName: string
  runtimeKey: string
  sessionCookie: string
  prompt: string
  documentContext: string
  deadlineAt: number
  threadId: string
}

/**
 * Sends one user turn through the Agents chat WebSocket used by Garden's UI.
 * Before this adapter, evals had no chat execution path. References:
 * `chat-runtime-provider.tsx`, `@cloudflare/ai-chat`'s request frame, and the
 * installed `agents/client` sub-agent path builder.
 */
export function sendGardenChatTurn(
  input: ChatSocketInput,
): Promise<Result<{ text: string }, GardenEvalError>> {
  const remainingMs = input.deadlineAt - Date.now()
  if (remainingMs <= 0) {
    return Promise.resolve(
      Result.err(
        new GardenEvalError({
          stage: 'garden_execution',
          code: 'deadline_reached',
          message: 'The eval deadline expired before the chat turn.',
          invalidReason: 'garden_execution_failed',
          threadId: input.threadId,
        }),
      ),
    )
  }

  const host = new URL(input.baseUrl).host
  const runtimePath = `sub/chat-sub-agent/${encodeURIComponent(input.runtimeKey)}`
  const AuthenticatedWebSocket = class extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie: input.sessionCookie } })
    }
  }
  const client = new AgentClient({
    agent: 'AgentDO',
    name: input.hostName,
    host,
    protocol: new URL(input.baseUrl).protocol === 'https:' ? 'wss' : 'ws',
    path: runtimePath,
    WebSocket: AuthenticatedWebSocket,
    shouldReconnectOnClose: () => false,
  })
  const requestId = randomUUID()

  return new Promise((resolve) => {
    let settled = false
    let identified = false
    let historySynced = false
    let requestSent = false
    let responseText = ''

    const cleanup = () => {
      clearTimeout(timeout)
      client.removeEventListener('message', onMessage)
      client.removeEventListener('close', onClose)
      client.removeEventListener('error', onError)
      client.close()
    }

    const finish = (result: Result<{ text: string }, GardenEvalError>) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const fail = (code: string, message: string) =>
      finish(
        Result.err(
          new GardenEvalError({
            stage: 'garden_execution',
            code,
            message,
            invalidReason: 'garden_execution_failed',
            threadId: input.threadId,
          }),
        ),
      )

    const dispatch = () => {
      if (!identified || !historySynced || requestSent || settled) return
      requestSent = true
      const message = JSON.stringify({
        id: requestId,
        init: {
          method: 'POST',
          body: JSON.stringify({
            messages: [
              {
                id: randomUUID(),
                role: 'user',
                parts: [{ type: 'text', text: input.prompt }],
              },
            ],
            document_context: input.documentContext,
          }),
        },
        type: 'cf_agent_use_chat_request',
      })
      const sendResult = Result.try({
        try: () => client.send(message),
        catch: () =>
          new GardenEvalError({
            stage: 'garden_execution',
            code: 'chat_request_send_failed',
            message: 'Garden did not accept the chat request.',
            invalidReason: 'garden_execution_failed',
            threadId: input.threadId,
          }),
      })
      sendResult.match({
        ok: () => {},
        err: (error) => finish(Result.err(error)),
      })
    }

    const onMessage = (event: MessageEvent) => {
      const raw =
        typeof event.data === 'string'
          ? event.data
          : Buffer.isBuffer(event.data)
            ? event.data.toString('utf8')
            : null
      if (raw === null) return

      const parsed = Result.try({
        try: () => JSON.parse(raw) as unknown,
        catch: () => null,
      })
      if (Result.isError(parsed) || parsed.value === null) return

      const syncFrame = connectSyncFrameSchema.safeParse(parsed.value)
      if (syncFrame.success) {
        historySynced = true
        dispatch()
        return
      }

      const responseFrame = chatResponseFrameSchema.safeParse(parsed.value)
      if (!responseFrame.success || responseFrame.data.id !== requestId) return
      if (responseFrame.data.error) {
        fail('chat_turn_failed', 'Garden returned an error for the chat turn.')
        return
      }

      if (responseFrame.data.body.trim()) {
        const chunkResult = Result.try({
          try: () => JSON.parse(responseFrame.data.body) as unknown,
          catch: () => null,
        })
        if (!Result.isError(chunkResult) && chunkResult.value !== null) {
          const textDelta = textDeltaSchema.safeParse(chunkResult.value)
          if (textDelta.success) responseText += textDelta.data.delta
        }
      }

      if (responseFrame.data.done) finish(Result.ok({ text: responseText }))
    }

    const onClose = () =>
      fail('chat_socket_closed', 'Garden closed the chat connection before the turn ended.')
    const onError = () =>
      fail('chat_socket_error', 'The Garden chat connection failed.')

    const timeout = setTimeout(
      () =>
        fail('deadline_reached', 'The Garden chat turn exceeded the eval deadline.'),
      remainingMs,
    )
    client.addEventListener('message', onMessage)
    client.addEventListener('close', onClose)
    client.addEventListener('error', onError)
    client.ready.then(
      () => {
        identified = true
        dispatch()
      },
      () => fail('chat_identity_failed', 'Garden did not identify the chat runtime.'),
    )
  })
}
