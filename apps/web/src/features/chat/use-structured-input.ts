import { useCallback, useMemo, useRef, useState } from 'react'
import { getToolName, isToolUIPart } from 'ai'
import { getToolCallId, getToolInput } from '@cloudflare/ai-chat/react'
import type {
  StructuredQuestion,
  StructuredQuestionAnswers,
} from '@garden/app-state/chat'
import type { ChatRuntime, ChatUiMessage } from './chat-runtime-provider'

/**
 * Detects the latest pending `askUserInput` tool call and submits the user's
 * answers exactly once. Lifted out of the controller (review #4). The submitted
 * set + the detection both reset at render time on a session switch — no
 * useEffect.
 */
export function useStructuredInput({
  sessionId,
  messages,
  addToolOutput,
}: {
  sessionId: string
  messages: ChatUiMessage[]
  addToolOutput: ChatRuntime['addToolOutput']
}) {
  // B6: askUserInput tool calls already answered this session. The panel can
  // fire onSubmit from two paths (single-select auto-advance + last-question
  // handleAdvance); a second addToolOutput for the same toolCallId is rejected
  // by the SDK's serialized tool channel and wedges the turn.
  const submittedToolCallIdsRef = useRef<Set<string>>(new Set())
  const [prevSessionId, setPrevSessionId] = useState(sessionId)
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId)
    submittedToolCallIdsRef.current = new Set()
  }

  // Walk messages backward to find the latest askUserInput tool call waiting for
  // a selection. The AI SDK surfaces client-side tools (no execute) as
  // "input-available".
  const pendingStructuredInput = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message || message.role !== 'assistant') continue
      for (const part of message.parts) {
        if (!isToolUIPart(part)) continue
        if (getToolName(part) !== 'askUserInput') continue
        if ((part as { state: string }).state !== 'input-available') continue
        const input = getToolInput(part) as
          | { questions?: StructuredQuestion[] }
          | undefined
        if (input?.questions && input.questions.length > 0) {
          return {
            toolCallId: getToolCallId(part),
            questions: input.questions,
          }
        }
      }
    }
    return null
  }, [messages])

  const handleSubmitAnswers = useCallback(
    (answers: StructuredQuestionAnswers) => {
      if (!pendingStructuredInput || !addToolOutput) return
      const { toolCallId } = pendingStructuredInput
      if (submittedToolCallIdsRef.current.has(toolCallId)) return
      submittedToolCallIdsRef.current.add(toolCallId)
      addToolOutput({ toolCallId, output: answers })
    },
    [addToolOutput, pendingStructuredInput],
  )

  return { pendingStructuredInput, handleSubmitAnswers }
}
