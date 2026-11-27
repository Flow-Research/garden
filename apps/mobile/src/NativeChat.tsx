import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Text, TextInput, View } from 'react-native'
import { useAgent } from 'agents/react'
import { useAgentChat } from '@cloudflare/ai-chat/react'
import { Result } from 'better-result'
import {
  chatAgentPath,
  chatFacetPath,
  type ChatThreadTarget,
} from '@garden/client'
import type { createMobileController } from './controller'

type Controller = ReturnType<typeof createMobileController>
type SdkConnection = Parameters<typeof useAgentChat>[0]['agent']

/** Keeps SDK connections inside the current online account/workspace surface. */
export function NativeChat({
  controller,
  thread,
  origin,
}: {
  controller: Controller
  thread: ChatThreadTarget
  origin: string
}) {
  const [Socket] = useState(() => controller.chatSocket(chatFacetPath(thread)))
  return Socket ? (
    <ConnectedChat
      controller={controller}
      thread={thread}
      origin={origin}
      Socket={Socket}
    />
  ) : (
    <Text>Chat sign-in is unavailable.</Text>
  )
}

function ConnectedChat({
  controller,
  thread,
  origin,
  Socket,
}: {
  controller: Controller
  thread: ChatThreadTarget
  origin: string
  Socket: typeof WebSocket
}) {
  const [policyRefused] = useState(() => controller.chatPolicyRefusal(thread))
  const [historyReady, setHistoryReady] = useState(false)
  const [connected, setConnected] = useState(false)
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const input =
    state.chatDraft?.threadId === thread.id ? state.chatDraft.text : ''
  const setInput = (text: string) => {
    void controller.saveChatDraft(thread.id, text)
  }
  const [notice, setNotice] = useState('Loading owned chat history')
  const [unknownDelivery, setUnknownDelivery] = useState(false)
  const sending = useRef(false)
  const target = new URL(origin)
  const rawAgent = useAgent({
    agent: 'AgentDO',
    name: thread.hostName,
    basePath: chatAgentPath(thread.hostName).slice(1),
    host: target.host,
    protocol: target.protocol === 'https:' ? 'wss' : 'ws',
    sub: [{ agent: 'ChatSubAgent', name: thread.runtime_key }],
    WebSocket: Socket,
    maxEnqueuedMessages: 0,
    transferEnqueuedMessages: false,
    shouldReconnectOnClose: () => false,
    onOpen: () => {
      setConnected(true)
      setHistoryReady(false)
    },
    onClose: (event) => {
      if (event.code === 1008) policyRefused()
      setConnected(false)
      setHistoryReady(false)
      setNotice(
        'Chat disconnected. Reload history before sending. No message was queued.',
      )
    },
    onError: () => {
      setNotice('Chat connection failed. Reload history before sending.')
    },
    onMessage: (event) => {
      const decoded = Result.try({
        try: () => JSON.parse(String(event.data)) as unknown,
        catch: () => null,
      })
      if (
        decoded.isOk() &&
        decoded.value &&
        typeof decoded.value === 'object' &&
        'type' in decoded.value &&
        decoded.value.type === 'cf_agent_chat_messages'
      ) {
        setHistoryReady(true)
        setNotice('Chat history synchronized. Each send checks current access.')
      }
    },
  })
  const agent = useMemo<SdkConnection>(
    () => ({
      agent: rawAgent.agent,
      name: rawAgent.name,
      path: rawAgent.path,
      getHttpUrl: () => rawAgent.getHttpUrl(),
      addEventListener: (type, listener, options) =>
        rawAgent.addEventListener(type, listener as EventListener, {
          ...options,
          capture: false,
        }),
      removeEventListener: (type, listener) =>
        rawAgent.removeEventListener(type, listener as EventListener),
      send: (data: string) => {
        if (
          controller.getSnapshot().phase !== 'ready' ||
          controller.getSnapshot().selectedThread?.id !== thread.id ||
          controller.getSnapshot().selectedThread?.hostName !==
            thread.hostName ||
          controller.getSnapshot().selectedThread?.runtime_key !==
            thread.runtime_key ||
          rawAgent.readyState !== rawAgent.OPEN
        )
          throw new Error(
            'Chat access or connection changed. Nothing was queued.',
          )
        if (!rawAgent.send(data))
          throw new Error('Chat disconnected. Nothing was queued.')
      },
    }),
    [rawAgent, controller, thread.id, thread.hostName, thread.runtime_key],
  )
  const chat = useAgentChat({
    agent,
    getInitialMessages: null,
    cancelOnClientAbort: false,
    autoContinueAfterToolResult: false,
    sendAutomaticallyWhen: () => false,
    prepareSendMessagesRequest: async () => {
      const access = await controller.authorizeChat(thread)
      if (access.isErr()) throw access.error
      return {}
    },
    onError: () => {
      setUnknownDelivery(true)
      setNotice(
        'Delivery is unconfirmed. Reload history and inspect it before another send.',
      )
    },
    onFinish: ({ isAbort, isError, isDisconnect, finishReason }) => {
      if (isAbort || isError || isDisconnect || finishReason === undefined) {
        setUnknownDelivery(true)
        setNotice(
          'Delivery is unconfirmed. Reload history and inspect it before another send.',
        )
      } else
        setNotice(
          'Reply completed. Review the conversation before sending again.',
        )
    },
  })

  async function send() {
    if (
      sending.current ||
      !historyReady ||
      !connected ||
      unknownDelivery ||
      !input.trim()
    )
      return
    sending.current = true
    const text = input
    const result = await Result.tryPromise({
      try: () => chat.sendMessage({ text }),
      catch: () => null,
    })
    if (result.isErr()) {
      setUnknownDelivery(true)
      setNotice('Delivery is unconfirmed. Reload history before another send.')
    }
    sending.current = false
  }

  if (state.phase === 'blocked' || state.accountId !== thread.ownerUserId)
    return null

  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header">{thread.title}</Text>
      <Text accessibilityLiveRegion="polite">{notice}</Text>
      <Text>
        Chat state: {chat.status}
        {chat.isRecovering ? ' / recovering' : ''}
        {chat.isServerStreaming ? ' / server streaming' : ''}
      </Text>
      {chat.messages.map((message) => (
        <View key={message.id}>
          <Text>{message.role}</Text>
          {message.parts.map((part, index) =>
            part.type === 'text' ? (
              <Text key={`${message.id}-${index}`} selectable>
                {part.text}
              </Text>
            ) : (
              <Text key={`${message.id}-${index}`}>
                Additional chat content is available in the web app.
              </Text>
            ),
          )}
        </View>
      ))}
      <TextInput
        accessibilityLabel="Chat message"
        value={input}
        onChangeText={setInput}
        multiline
        maxLength={2000}
        style={{ borderWidth: 1, minHeight: 80, padding: 12 }}
      />
      <Text>
        One private chat draft is saved on this device. Editing another chat
        replaces that saved chat draft. Sending can use the workspace model. It
        never sends automatically.
      </Text>
      <Button
        title="Send chat message"
        disabled={
          !connected ||
          !historyReady ||
          unknownDelivery ||
          chat.isStreaming ||
          chat.isRecovering ||
          chat.status === 'submitted' ||
          !input.trim()
        }
        onPress={() => {
          void send()
        }}
      />
      <Button title="Clear chat input" onPress={() => setInput('')} />
      <Button
        title="Reload chat history"
        onPress={() => {
          void controller.selectThread(thread.id)
        }}
      />
      <Text>
        Leaving this view disconnects the client. It does not cancel the server
        turn.
      </Text>
    </View>
  )
}
