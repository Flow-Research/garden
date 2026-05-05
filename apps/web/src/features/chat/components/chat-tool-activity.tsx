'use client'

/**
 * Tool-call activity + approval rendering.
 *
 * Extracted from `chat-message-parts.tsx`. Owns:
 *   - Streaming "work" rendering: PreResponseWrapper, StreamingWorkSection,
 *     StreamingWorkEntryRow, PendingAssistantActivity.
 *   - MessageToolActivity (the read-only tool-call summary).
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
  formatApprovalToolName,
  type ApprovalGroup,
  type ChatWorkEntry,
} from './chat-message-parts'

export function MessageToolActivity({
  debugMode,
  message,
}: {
  debugMode: boolean
  message: ChatUiMessage
}) {
  const tools = message.parts.flatMap((part, index) => {
    if (!isToolUIPart(part)) return []
    const toolName = getToolName(part)
    const state = String(getToolPartState(part))
    const input = getToolInput(part)
    const record = part as unknown as Record<string, unknown>
    const output = record.output ?? record.result
    return [
      {
        active:
          state === 'streaming' ||
          state === 'loading' ||
          state === 'input-streaming' ||
          state === 'input-available' ||
          state === 'running' ||
          state === 'waiting-approval',
        key: `${message.id}:tool:${index}`,
        input,
        output,
        state,
        toolName,
      },
    ]
  })
  if (tools.length === 0) return null

  const entries = tools.map((toolItem): ChatWorkEntry => {
    const label = debugMode
      ? toolItem.toolName
      : productToolLabel(toolItem.toolName, toolItem.input)
    const inputPreview = formatApprovalInput(toolItem.input)
    const outputPreview = formatApprovalInput(toolItem.output)
    return {
      active: toolItem.active,
      detail: debugMode
        ? [
            `state\n${toolItem.state}`,
            `input\n${inputPreview || '{}'}`,
            outputPreview ? `output\n${outputPreview}` : null,
          ]
            .filter(Boolean)
            .join('\n\n')
        : toolStateLabel(toolItem.state),
      id: toolItem.key,
      label,
      tone: toolItem.active ? 'tool' : 'info',
    }
  })

  return (
    <StreamingWorkSection
      entries={entries}
      groupLabel="Tool calls"
      isWorking={tools.some((toolItem) => toolItem.active)}
    />
  )
}

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

export function StreamingWorkSection({
  entries,
  groupLabel,
  isWorking,
}: {
  entries: ChatWorkEntry[]
  groupLabel: string
  isWorking: boolean
}) {
  if (entries.length === 0) return null

  return (
    <ChainOfThought defaultOpen>
      <ChainOfThoughtHeader>
        {isWorking ? 'Working' : groupLabel} ({entries.length})
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {entries.map((entry) => (
          <StreamingWorkEntryRow
            key={entry.id}
            entry={entry}
          />
        ))}
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

export function toolStateLabel(state: string) {
  switch (state) {
    case 'streaming':
    case 'input-streaming':
      return 'thinking'
    case 'loading':
    case 'input-available':
    case 'running':
      return 'calling'
    case 'complete':
    case 'approved':
    case 'output-available':
      return 'done'
    case 'error':
    case 'output-error':
      return 'error'
    case 'waiting-approval':
      return 'approval'
    case 'denied':
      return 'denied'
    default:
      return state.split('-').join(' ')
  }
}

export function productToolLabel(toolName: string, input: unknown, output?: unknown) {
  const record =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const outputRecord =
    output && typeof output === 'object'
      ? (output as Record<string, unknown>)
      : {}
  const filename =
    typeof outputRecord.filename === 'string'
      ? outputRecord.filename
      : typeof record.filename === 'string'
        ? record.filename
        : typeof record.title === 'string'
          ? record.title
          : null
  switch (toolName) {
    case 'listDocuments':
      return 'Checking available documents'
    case 'readDocument':
      return filename ? `Reading ${filename}` : 'Reading document'
    case 'findInDocument':
      return filename ? `Searching ${filename}` : 'Searching document'
    case 'generateDocx':
      return filename ? `Writing ${filename}` : 'Writing document'
    case 'editDocument':
      return filename ? `Editing ${filename}` : 'Preparing tracked edits'
    case 'convertDocumentToPdf':
      return filename ? `Converting ${filename}` : 'Converting document to PDF'
    case 'askUserInput':
      return 'Waiting for your input'
    default:
      return formatApprovalToolName(toolName)
  }
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
  resolvingToolCallIds,
}: {
  debugMode: boolean
  message: ChatUiMessage
  onResolve: (group: ApprovalGroup, approved: boolean) => Promise<void>
  resolvedApprovalIds: string[]
  resolvingToolCallIds: string[]
}) {
  const groups = message.parts.reduce<ApprovalGroup[]>((acc, part) => {
    if (!isToolUIPart(part)) {
      return acc
    }

    const toolName = getToolName(part)
    const toolCallId = getToolCallId(part)
    const input = getToolInput(part)
    const agentProposal =
      toolName === 'propose_agent' ? getAgentProposalApproval(part) : null
    if (agentProposal) {
      if (resolvedApprovalIds.includes(agentProposal.permissionRequestId)) {
        return acc
      }
      return [
        ...acc,
        {
          approvalIds: [agentProposal.permissionRequestId],
          input,
          key: `${toolName}:${agentProposal.permissionRequestId}`,
          permissionRequestId: agentProposal.permissionRequestId,
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
