import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getToolName, isToolUIPart } from 'ai'
import {
  chatKeys,
  listThreadAgentProposalRequests,
} from '@/lib/api/chat-threads'
import { resolveToolApproval } from './components/chat-tool-activity'
import type { ApprovalGroup } from './components/chat-message-parts'
import type { ChatRuntime, ChatUiMessage } from './chat-runtime-provider'

/**
 * Owns the whole tool-approval surface: optimistic + durable resolution state,
 * the propose_agent ledger status query, and the approve/deny →
 * resume flow. Lifted out of ConnectedChatPanelInteraction so the controller
 * just threads props (review #4 — approval state shouldn't live inline in a
 * 950-line component). Per-session state resets at render time via the prev-id
 * pattern, not a useEffect.
 */
type ContinuationInput = Parameters<
  ChatRuntime['continueAfterGardenApproval']
>[0]

export function useToolApprovals({
  sessionId,
  messages,
  addToolApprovalResponse,
  continueAfterGardenApproval,
}: {
  sessionId: string
  messages: ChatUiMessage[]
  addToolApprovalResponse: ChatRuntime['addToolApprovalResponse']
  continueAfterGardenApproval: ChatRuntime['continueAfterGardenApproval']
}) {
  const queryClient = useQueryClient()
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [resolvingToolCallIds, setResolvingToolCallIds] = useState<string[]>([])
  const [resolvedApprovalIds, setResolvedApprovalIds] = useState<string[]>([])
  // A recorded approval whose agent resume failed, kept so it can be retried.
  const [failedContinuation, setFailedContinuation] =
    useState<ContinuationInput | null>(null)
  const [isContinuing, setIsContinuing] = useState(false)
  const [prevSessionId, setPrevSessionId] = useState(sessionId)
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId)
    setApprovalError(null)
    setResolvingToolCallIds([])
    setResolvedApprovalIds([])
    setFailedContinuation(null)
    setIsContinuing(false)
  }
  // Async results land after their awaits; one that belongs to a session the
  // user has since left must not write into the new session's state.
  const currentSessionRef = useRef(sessionId)
  useEffect(() => {
    currentSessionRef.current = sessionId
  }, [sessionId])
  // Tool calls with a response in flight. State updates only after the
  // await, so a double click inside the request window used to send two.
  const inFlightToolCallIdsRef = useRef(new Set<string>())

  // B2: server-authoritative resolution for propose_agent approvals. Only fetch
  // when the thread actually has a proposal; refetches on reconnect/focus so a
  // card reconciles to durable status instead of a stale tool-output snapshot.
  const hasAgentProposal = useMemo(
    () =>
      messages.some((message) =>
        message.parts.some(
          (part) => isToolUIPart(part) && getToolName(part) === 'propose_agent',
        ),
      ),
    [messages],
  )
  const agentProposalRequestsQuery = useQuery({
    queryKey: chatKeys.agentProposalRequests(sessionId),
    queryFn: () => listThreadAgentProposalRequests(sessionId),
    enabled: hasAgentProposal,
    staleTime: 30_000,
  })
  const resolvedAgentProposalRequestIds = useMemo(() => {
    const ids = new Set<string>()
    for (const request of agentProposalRequestsQuery.data?.requests ?? []) {
      if (request.status !== 'pending') ids.add(request.id)
    }
    return ids
  }, [agentProposalRequestsQuery.data])

  /**
   * Tells the agent to resume after a recorded approval. `agent.call` rejects
   * on a dropped socket or timeout; that used to escape as an unhandled
   * rejection, leaving the card resolved, its spinner on and the chat
   * "thinking" with no way to retry.
   */
  const runContinuation = useCallback(
    async (input: ContinuationInput) => {
      const requestSessionId = sessionId
      setIsContinuing(true)
      const continuation = await continueAfterGardenApproval(input).then(
        (result) => result,
        (cause: unknown) => ({
          ok: false as const,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      // Refresh durable status so the card reflects approved/denied even if
      // this client's optimistic state is later dropped (B2).
      void queryClient.invalidateQueries({
        queryKey: chatKeys.agentProposalRequests(requestSessionId),
      })
      if (currentSessionRef.current !== requestSessionId) return
      setIsContinuing(false)
      if (continuation.ok) {
        setFailedContinuation(null)
        return
      }
      setFailedContinuation(input)
      setApprovalError(
        `The approval was recorded, but the agent could not resume: ${continuation.error}`,
      )
    },
    [continueAfterGardenApproval, queryClient, sessionId],
  )

  const retryApprovalContinuation = useCallback(() => {
    if (!failedContinuation || isContinuing) return
    setApprovalError(null)
    void runContinuation(failedContinuation)
  }, [failedContinuation, isContinuing, runContinuation])

  const handleResolveToolApproval = useCallback(
    async (group: ApprovalGroup, approved: boolean) => {
      // B3: idempotency — never respond to an approval that's already resolved
      // (double-click, or a card that reappeared after a reconnect). The SDK
      // serializes tool results, so a duplicate response wedges the session.
      if (group.approvalIds.every((id) => resolvedApprovalIds.includes(id))) {
        return
      }
      const inFlight = inFlightToolCallIdsRef.current
      if (group.toolCallIds.some((id) => inFlight.has(id))) return
      for (const id of group.toolCallIds) inFlight.add(id)
      const releaseInFlight = () => {
        for (const id of group.toolCallIds) inFlight.delete(id)
      }
      const requestSessionId = sessionId
      setApprovalError(null)
      setResolvingToolCallIds((current) => [
        ...new Set([...current, ...group.toolCallIds]),
      ])

      const result = await resolveToolApproval({
        approved,
        threadId: sessionId,
        ...(group.permissionRequestId
          ? { permissionRequestId: group.permissionRequestId }
          : { toolCallId: group.toolCallIds[0] ?? '' }),
      }).catch((cause: unknown) => {
        setApprovalError(
          cause instanceof Error ? cause.message : 'Failed to resolve approval',
        )
        return null
      })

      const clearResolving = () =>
        setResolvingToolCallIds((current) =>
          current.filter((id) => !group.toolCallIds.includes(id)),
        )

      if (!result) {
        releaseInFlight()
        clearResolving()
        return
      }
      if (currentSessionRef.current !== requestSessionId) {
        releaseInFlight()
        return
      }

      setResolvedApprovalIds((current) => [
        ...new Set([...current, ...group.approvalIds]),
      ])

      if (group.permissionRequestId) {
        // B1: REST recorded the approval, but the durable Think turn only
        // resumes when we tell the agent — otherwise the approved sub-agent
        // never spawns and the chat hangs "thinking".
        await runContinuation({
          approved,
          permissionRequestId: group.permissionRequestId,
          pendingAgentId: group.pendingAgentId ?? null,
        })
      } else {
        // B4: respond per (toolCallId → approvalId), keyed by the toolCallIds the
        // server actually resolved — not by positional index, which mis-routes
        // when the server returns a subset/reordered set for grouped calls.
        const approvalByToolCallId = new Map<string, string>()
        group.toolCallIds.forEach((toolCallId, index) => {
          const approvalId = group.approvalIds[index]
          if (toolCallId && approvalId) {
            approvalByToolCallId.set(toolCallId, approvalId)
          }
        })
        const targetToolCallIds =
          result.toolCallIds.length > 0 ? result.toolCallIds : group.toolCallIds
        for (const toolCallId of targetToolCallIds) {
          const approvalId = approvalByToolCallId.get(toolCallId)
          if (approvalId) {
            addToolApprovalResponse?.({ id: approvalId, approved })
          }
        }
      }

      releaseInFlight()
      clearResolving()
    },
    [addToolApprovalResponse, resolvedApprovalIds, runContinuation, sessionId],
  )

  return {
    approvalError,
    /** True when a recorded approval's agent resume failed and can be retried. */
    canRetryApprovalContinuation: failedContinuation !== null,
    isContinuingApproval: isContinuing,
    retryApprovalContinuation,
    resolvingToolCallIds,
    resolvedApprovalIds,
    resolvedAgentProposalRequestIds,
    handleResolveToolApproval,
  }
}
