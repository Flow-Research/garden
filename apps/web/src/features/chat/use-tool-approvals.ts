import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getToolName, isToolUIPart } from 'ai'
import { chatKeys, listThreadPermissionRequests } from '@/lib/api/chat-threads'
import { resolveToolApproval } from './components/chat-tool-activity'
import type { ApprovalGroup } from './components/chat-message-parts'
import type { ChatRuntime, ChatUiMessage } from './chat-runtime-provider'

/**
 * Owns the whole tool-approval surface: optimistic + durable resolution state,
 * the propose_agent permission-request status query, and the approve/deny →
 * resume flow. Lifted out of ConnectedChatPanelInteraction so the controller
 * just threads props (review #4 — approval state shouldn't live inline in a
 * 950-line component). Per-session state resets at render time via the prev-id
 * pattern, not a useEffect.
 */
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
  const [prevSessionId, setPrevSessionId] = useState(sessionId)
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId)
    setApprovalError(null)
    setResolvingToolCallIds([])
    setResolvedApprovalIds([])
  }

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
  const permissionRequestsQuery = useQuery({
    queryKey: chatKeys.permissionRequests(sessionId),
    queryFn: () => listThreadPermissionRequests(sessionId),
    enabled: hasAgentProposal,
    staleTime: 30_000,
  })
  const resolvedPermissionRequestIds = useMemo(() => {
    const ids = new Set<string>()
    for (const request of permissionRequestsQuery.data?.requests ?? []) {
      if (request.status !== 'pending') ids.add(request.id)
    }
    return ids
  }, [permissionRequestsQuery.data])

  const handleResolveToolApproval = useCallback(
    async (group: ApprovalGroup, approved: boolean) => {
      // B3: idempotency — never respond to an approval that's already resolved
      // (double-click, or a card that reappeared after a reconnect). The SDK
      // serializes tool results, so a duplicate response wedges the session.
      if (group.approvalIds.every((id) => resolvedApprovalIds.includes(id))) {
        return
      }
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
        clearResolving()
        return
      }

      setResolvedApprovalIds((current) => [
        ...new Set([...current, ...group.approvalIds]),
      ])

      if (group.permissionRequestId) {
        // B1: REST recorded the approval, but the durable Think turn only
        // resumes when we tell the agent — otherwise the approved sub-agent
        // never spawns and the chat hangs "thinking".
        const continuation = await continueAfterGardenApproval({
          approved,
          permissionRequestId: group.permissionRequestId,
          pendingAgentId: group.pendingAgentId ?? null,
        })
        if (!continuation.ok) {
          setApprovalError(continuation.error)
        }
        // Refresh durable status so the card reflects approved/denied even if
        // this client's optimistic state is later dropped (B2).
        void queryClient.invalidateQueries({
          queryKey: chatKeys.permissionRequests(sessionId),
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

      clearResolving()
    },
    [
      addToolApprovalResponse,
      continueAfterGardenApproval,
      queryClient,
      resolvedApprovalIds,
      sessionId,
    ],
  )

  return {
    approvalError,
    resolvingToolCallIds,
    resolvedApprovalIds,
    resolvedPermissionRequestIds,
    handleResolveToolApproval,
  }
}
