'use client'

/**
 * Tool-call activity + approval rendering.
 *
 * Extracted from `chat-message-parts.tsx`. Owns:
 *   - Streaming "work" rendering: PreResponseWrapper, StreamingWorkEntryRow,
 *     PendingAssistantActivity (rendered by the MessageOrderedParts `work` node).
 *   - MessageToolApprovals (interactive approval cards).
 *   - Pure helpers: toolStateLabel, productToolLabel,
 *     extractApprovalDescription.
 *   - resolveToolApproval — the API wrapper that flips the
 *     waiting-approval state.
 */

import { Loader2 } from 'lucide-react'
import {
  getToolApproval,
  getToolCallId,
  getToolInput,
  getToolPartState,
} from '@cloudflare/ai-chat/react'
import { getToolName, isToolUIPart } from 'ai'
import { cn } from '@garden/ui/lib/utils'
import { resolveToolApproval as resolveToolApprovalRequest } from '@/lib/api'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import {
  Confirmation,
  ConfirmationActions,
  ConfirmationAction,
  ConfirmationRequest,
} from '@/components/ai-elements/confirmation'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ai-elements/code-block'
import type { ChatUiMessage } from '../chat-runtime-provider'
import {
  canonicalJsonString,
  formatApprovalInput,
  type ApprovalGroup,
  type ChatWorkEntry,
} from './chat-message-model'

export function PreResponseWrapper({
  children,
  isStreaming,
  shouldMinimize,
  stepCount,
}: {
  children: React.ReactNode
  isStreaming: boolean
  shouldMinimize: boolean
  stepCount: number
}) {
  const stepWord = `step${stepCount === 1 ? '' : 's'}`
  const label = isStreaming
    ? 'Working'
    : `Completed in ${stepCount} ${stepWord}`

  return (
    <ChainOfThought defaultOpen={!shouldMinimize}>
      <ChainOfThoughtHeader>{label}</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {children}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}

export function StreamingWorkEntryRow({
  entry,
}: {
  entry: ChatWorkEntry
  showConnector?: boolean
}) {
  const isDone = !entry.active && entry.detail === 'done'
  const showDetailBlock = Boolean(entry.detail?.includes('\n'))
  return (
    <ChainOfThoughtStep
      label={
        <span
          className={cn(
            'font-medium text-foreground/80',
            isDone && 'line-through decoration-muted-foreground/70',
          )}
        >
          {entry.label}
        </span>
      }
      description={
        entry.detail && !showDetailBlock && !isDone
          ? entry.detail
          : undefined
      }
      status={entry.active ? 'active' : 'complete'}
    >
      {entry.detail && showDetailBlock ? (
        <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
          {entry.detail}
        </pre>
      ) : null}
    </ChainOfThoughtStep>
  )
}

export function PendingAssistantActivity({ label }: { label: string }) {
  return (
    <div className="relative flex items-center text-sm text-muted-foreground">
      <div className="size-1.5 shrink-0 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
      <span className="ml-2">{label}</span>
    </div>
  )
}

export async function resolveToolApproval(args: {
  approved: boolean
  threadId: string
  toolCallId?: string
  permissionRequestId?: string
}) {
  const payload = await resolveToolApprovalRequest(args)
  return {
    toolCallIds: Array.isArray(payload?.toolCallIds)
      ? payload.toolCallIds.filter(
          (toolCallId): toolCallId is string => typeof toolCallId === 'string',
        )
      : [],
  }
}

function getToolOutput(part: ChatUiMessage['parts'][number]) {
  const record = part as unknown as Record<string, unknown>
  return record.output ?? record.result
}

function getAgentProposalApproval(part: ChatUiMessage['parts'][number]) {
  const output = getToolOutput(part)
  if (!output || typeof output !== 'object') return null
  const record = output as Record<string, unknown>
  const permissionRequestId = record.permission_request_id
  const pendingAgentId = record.pending_agent_id
  if (
    typeof permissionRequestId !== 'string' ||
    typeof pendingAgentId !== 'string'
  ) {
    return null
  }
  return { permissionRequestId, pendingAgentId }
}

/**
 * True when a tool approval is already resolved, from the most authoritative
 * source available [B2]:
 *  - propose_agent: the durable permission_request status (server), falling back
 *    to this client's optimistic ids while a resolve is in flight;
 *  - any other tool: the SDK's own approval state — `getToolApproval().approved`
 *    is set once the server records a response — falling back to optimistic ids.
 * Keeps every approval kind reconciling to server truth on reconnect instead of
 * trusting local state that's wiped on remount.
 */
function isApprovalResolved(args: {
  part: ChatUiMessage['parts'][number]
  localApprovalIds: string[]
  durablePermissionRequestIds: ReadonlySet<string>
}): boolean {
  const { part } = args
  if (!isToolUIPart(part)) return false
  const proposal =
    getToolName(part) === 'propose_agent'
      ? getAgentProposalApproval(part)
      : null
  if (proposal) {
    return (
      args.durablePermissionRequestIds.has(proposal.permissionRequestId) ||
      args.localApprovalIds.includes(proposal.permissionRequestId)
    )
  }
  const approval = getToolApproval(part)
  if (!approval?.id) return false
  if (approval.approved !== undefined) return true
  return args.localApprovalIds.includes(approval.id)
}

export function extractApprovalDescription(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  if (typeof record.reason === 'string' && record.reason.trim()) {
    return record.reason.trim()
  }
  if (typeof record.description === 'string' && record.description.trim()) {
    return record.description.trim()
  }
  return null
}

export function MessageToolApprovals({
  debugMode,
  message,
  onResolve,
  resolvedApprovalIds,
  resolvedPermissionRequestIds,
  resolvingToolCallIds,
}: {
  debugMode: boolean
  message: ChatUiMessage
  onResolve: (group: ApprovalGroup, approved: boolean) => Promise<void>
  resolvedApprovalIds: string[]
  /**
   * Permission-request ids the server reports as no longer pending (B2).
   * Authoritative over local optimistic state for propose_agent cards.
   */
  resolvedPermissionRequestIds: ReadonlySet<string>
  resolvingToolCallIds: string[]
}) {
  const groups = message.parts.reduce<ApprovalGroup[]>((acc, part) => {
    if (!isToolUIPart(part)) {
      return acc
    }

    const toolName = getToolName(part)
    const toolCallId = getToolCallId(part)
    const input = getToolInput(part)
    const resolved = isApprovalResolved({
      part,
      localApprovalIds: resolvedApprovalIds,
      durablePermissionRequestIds: resolvedPermissionRequestIds,
    })
    const agentProposal =
      toolName === 'propose_agent' ? getAgentProposalApproval(part) : null
    if (agentProposal) {
      // B2: hide once resolved per server-authoritative status (or optimistic).
      if (resolved) {
        return acc
      }
      return [
        ...acc,
        {
          approvalIds: [agentProposal.permissionRequestId],
          input,
          key: `${toolName}:${agentProposal.permissionRequestId}`,
          permissionRequestId: agentProposal.permissionRequestId,
          pendingAgentId: agentProposal.pendingAgentId,
          toolCallIds: [toolCallId],
          toolName,
        },
      ]
    }

    if (getToolPartState(part) !== 'waiting-approval') {
      return acc
    }

    const approval = getToolApproval(part)
    if (!approval?.id) {
      return acc
    }

    // B2/B3: hide once resolved — SDK-authoritative `approved` after a reconnect,
    // or this client's optimistic id while the resolve is in flight. Kills the
    // double-click race at the source and reconciles a resurfaced card.
    if (resolved) {
      return acc
    }

    const key = `${toolName}:${canonicalJsonString(input)}`
    const existingGroup = acc.find((candidate) => candidate.key === key)
    if (existingGroup) {
      existingGroup.approvalIds.push(approval.id)
      existingGroup.toolCallIds.push(toolCallId)
      return acc
    }

    return [
      ...acc,
      {
        approvalIds: [approval.id],
        input,
        key,
        toolCallIds: [toolCallId],
        toolName,
      },
    ]
  }, [])

  if (groups.length === 0) return null

  return (
    <div className="mt-3 space-y-3">
      {groups.map((group) => {
        const isResolving = group.toolCallIds.some((toolCallId) =>
          resolvingToolCallIds.includes(toolCallId),
        )
        const inputPreview = formatApprovalInput(group.input)

        return (
          <Confirmation
            key={`${message.id}:${group.key}`}
            approval={{ id: group.approvalIds[0] ?? '' }}
            state="approval-requested"
          >
            <ConfirmationRequest>
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {extractApprovalDescription(group.input) ??
                    'Approval required'}
                </p>
                {debugMode ? (
                  <p className="text-xs text-muted-foreground">
                    {group.toolName}
                    {group.toolCallIds.length > 1
                      ? ` · ${group.toolCallIds.length} grouped`
                      : ''}
                  </p>
                ) : group.toolCallIds.length > 1 ? (
                  <p className="text-xs text-muted-foreground">
                    {group.toolCallIds.length} matching actions grouped
                  </p>
                ) : null}
                {debugMode && inputPreview ? (
                  <div className="max-h-48 overflow-auto">
                    <CodeBlock code={inputPreview} language="json">
                      <CodeBlockHeader>
                        <CodeBlockTitle />
                        <CodeBlockActions>
                          <CodeBlockCopyButton />
                        </CodeBlockActions>
                      </CodeBlockHeader>
                    </CodeBlock>
                  </div>
                ) : null}
              </div>
            </ConfirmationRequest>
            <ConfirmationActions>
              <ConfirmationAction
                variant="outline"
                onClick={() => void onResolve(group, false)}
                disabled={isResolving}
              >
                Deny
              </ConfirmationAction>
              <ConfirmationAction
                variant="default"
                onClick={() => void onResolve(group, true)}
                disabled={isResolving}
              >
                {isResolving ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : null}
                Approve
              </ConfirmationAction>
            </ConfirmationActions>
          </Confirmation>
        )
      })}
    </div>
  )
}
