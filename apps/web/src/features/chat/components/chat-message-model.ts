/**
 * Pure chat message model — types, tool interpretation, and the
 * parts→render-model interpreter. NO React/JSX lives here, so the
 * grouping/flush algorithm and streaming-correctness rules are unit-testable in
 * isolation. The JSX renderers (MessageOrderedParts, artifacts, citations) live
 * in chat-message-parts.tsx and chat-artifacts.tsx and consume this module.
 */
import { getToolInput, getToolPartState } from '@cloudflare/ai-chat/react'
import { getToolName, isToolUIPart } from 'ai'
import { canonicalizeJson } from '@garden/connectors/capabilities'
import { isToolStateActive } from './chat-tool-state'
import {
  normalizeGardenArtifact,
  type GardenArtifactData,
} from '@/features/artifacts/artifact-renderer'
import type { ChatUiMessage } from '../chat-runtime-provider'

export { canonicalJsonString } from '@garden/connectors/capabilities'

export type ArtifactMessagePart = {
  type: string
  data?: Record<string, unknown>
}

export type ApprovalGroup = {
  approvalIds: string[]
  input: unknown
  key: string
  permissionRequestId?: string
  /**
   * For a `propose_agent` approval: the sub-agent the server is waiting to
   * spawn. Forwarded to `continueAfterGardenApproval` so the durable turn
   * resumes after the REST approval is recorded. [B1]
   */
  pendingAgentId?: string
  toolCallIds: string[]
  toolName: string
}

export type ChatWorkEntry = {
  active: boolean
  detail: string | null
  id: string
  label: string
  tone: 'thinking' | 'tool' | 'info' | 'error'
}

export type ToolActivityItem = ChatWorkEntry & {
  input: unknown
  output: unknown
  state: string
  toolName: string
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  css: 'css',
  scss: 'scss',
  html: 'html',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  dockerfile: 'dockerfile',
  xml: 'xml',
  graphql: 'graphql',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
}

const INTERNAL_DOCUMENT_CONTEXT_START = '<GARDEN_INTERNAL_DOCUMENT_CONTEXT>'
const INTERNAL_DOCUMENT_CONTEXT_END = '</GARDEN_INTERNAL_DOCUMENT_CONTEXT>'
const LEGACY_INTERNAL_DOCUMENT_CONTEXT_START =
  '\n\n[The user uploaded these workspace documents for this turn.'

export function getToolActivityItem(args: {
  debugMode: boolean
  index: number
  messageId: string
  part: ChatUiMessage['parts'][number]
}): ToolActivityItem | null {
  if (!isToolUIPart(args.part)) return null
  const toolName = getToolName(args.part)
  const state = String(getToolPartState(args.part))
  const input = getToolInput(args.part)
  const record = args.part as unknown as Record<string, unknown>
  const output = record.output ?? record.result
  const active = isToolStateActive(state)
  // A tool that ended in `output-error` is terminal (not active) but must not
  // read as a quiet success: surface its `errorText` and an error tone so a
  // failed connector call is visible instead of rendering as a neutral "info"
  // row with its message dropped. [M5]
  const errorText =
    state === 'output-error' && typeof record.errorText === 'string'
      ? record.errorText
      : undefined
  const label = args.debugMode
    ? toolName
    : productToolLabel(toolName, input, output)
  const inputPreview = formatApprovalInput(input)
  const outputPreview = formatApprovalInput(output)
  const detail = args.debugMode
    ? [
        `state\n${state}`,
        `input\n${inputPreview || '{}'}`,
        outputPreview ? `output\n${outputPreview}` : null,
        errorText ? `error\n${errorText}` : null,
      ]
        .filter(Boolean)
        .join('\n\n')
    : errorText
      ? `error — ${errorText}`
      : toolStateLabel(state)

  return {
    active,
    detail,
    id: `${args.messageId}:tool:${args.index}`,
    input,
    label,
    output,
    state,
    tone: errorText ? 'error' : active ? 'tool' : 'info',
    toolName,
  }
}

export function getToolOutputPayload(part: ChatUiMessage['parts'][number]) {
  const record = part as unknown as Record<string, unknown>
  return typeof record.type === 'string' && record.type.startsWith('tool-')
    ? ((record.output ?? record.result) as Record<string, unknown> | null)
    : null
}

export function inferLanguageFromFilename(
  filename: string | undefined | null,
): string | undefined {
  if (!filename) return undefined
  const ext = filename.split('.').pop()?.toLowerCase()
  if (!ext) return undefined
  return EXT_TO_LANG[ext]
}

export function stripGardenInternalDocumentContext(text: string) {
  let next = stripBetweenMarkers(
    text,
    INTERNAL_DOCUMENT_CONTEXT_START,
    INTERNAL_DOCUMENT_CONTEXT_END,
  )
  next = stripLegacyInternalDocumentContext(next)
  return next.trim()
}

function stripBetweenMarkers(
  text: string,
  startMarker: string,
  endMarker: string,
) {
  let next = text
  let start = next.indexOf(startMarker)
  while (start >= 0) {
    const end = next.indexOf(endMarker, start + startMarker.length)
    if (end < 0) return next.slice(0, start).trimEnd()
    next =
      next.slice(0, start).trimEnd() +
      next.slice(end + endMarker.length).trimStart()
    start = next.indexOf(startMarker)
  }
  return next
}

function stripLegacyInternalDocumentContext(text: string) {
  const start = text.indexOf(LEGACY_INTERNAL_DOCUMENT_CONTEXT_START)
  if (start < 0) return text
  const end = text.indexOf(']\n', start)
  if (end < 0) return text.slice(0, start).trimEnd()
  return `${text.slice(0, start).trimEnd()}\n\n${text
    .slice(end + 2)
    .trimStart()}`.trim()
}

export function formatApprovalToolName(toolName: string) {
  return toolName
    .replace(/^tool_[^_]+_/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
}

export function formatApprovalInput(input: unknown) {
  const text = JSON.stringify(canonicalizeJson(input ?? null), null, 2)
  return text === '{}' ? '' : text
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

export function productToolLabel(
  toolName: string,
  input: unknown,
  output?: unknown,
) {
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
      return filename ? `Editing ${filename}` : 'Editing document'
    case 'askUserInput':
      return 'Waiting for your input'
    default:
      return formatApprovalToolName(toolName)
  }
}

/**
 * The render model for one message: an ordered, typed list of what to draw, with
 * NO React in it. Extracted from `MessageOrderedParts`, which had grown into a
 * God-component interleaving three concerns inline — interpreting
 * `message.parts`, grouping consecutive tool calls into a "work" batch, and
 * emitting JSX. Pulling interpretation behind this seam makes the grouping/flush
 * algorithm explicit and testable, lets the component become a thin renderer,
 * and gives the streaming-correctness rules (M1/M2/M4) one home.
 */
type MessageRenderNode =
  | { kind: 'reasoning'; key: string; text: string; isStreaming: boolean }
  | { kind: 'text'; key: string; text: string }
  | {
      kind: 'work'
      key: string
      entries: ToolActivityItem[]
      active: boolean
      stepCount: number
    }
  | { kind: 'artifact'; key: string; artifact: GardenArtifactData }
  | {
      kind: 'raw'
      key: string
      index: number
      part: ChatUiMessage['parts'][number]
    }

/**
 * The data-part types `renderArtifactPart` actually draws. Used by the
 * interpreter so only genuinely-visible parts emit a node and flush the work
 * batch — keeping this in sync with `renderArtifactPart`'s own guard.
 */
function isRenderableArtifactPart(
  part: ChatUiMessage['parts'][number],
): boolean {
  const type = (part as { type?: unknown }).type
  return (
    type === 'data-artifact' ||
    type === 'data-graph' ||
    type === 'data-document-artifact'
  )
}

/**
 * Interpret a message's parts into an ordered render model. Consecutive tool
 * parts accumulate into one "work" batch that flushes when a non-tool
 * renderable (reasoning/text/artifact) interrupts them or the message
 * ends. Streaming-correctness rules live here:
 *  - reasoning shimmer is driven by the part's own `state === 'streaming'`,
 *    gated by whole-message streaming so finished history never shimmers. [M1]
 *  - a work batch is keyed by the index of its FIRST tool part — a stable key
 *    that doesn't shift as content streams in above it, so the batch no longer
 *    remounts/flickers. [M4]
 */
export function buildMessageRenderModel(
  message: ChatUiMessage,
  opts: { debugMode: boolean; isLatestStreaming?: boolean },
): MessageRenderNode[] {
  const { debugMode, isLatestStreaming } = opts
  const nodes: MessageRenderNode[] = []

  let work: ToolActivityItem[] = []
  let workFirstIndex = -1
  let workActive = false
  const flushWork = () => {
    if (work.length === 0) return
    nodes.push({
      kind: 'work',
      key: `${message.id}:work:${workFirstIndex}`,
      entries: work,
      active: workActive,
      stepCount: work.length,
    })
    work = []
    workFirstIndex = -1
    workActive = false
  }

  message.parts.forEach((part, index) => {
    if (part.type === 'reasoning') {
      // Reasoning is only rendered in debug mode. Guard visibility BEFORE
      // flushing the work batch — otherwise a hidden reasoning part splits a
      // contiguous visible work group in two for no on-screen reason.
      if (!debugMode) return
      const reasoningPart = part as {
        type: 'reasoning'
        text: string
        state?: string
      }
      if (!reasoningPart.text.trim()) return
      flushWork()
      nodes.push({
        kind: 'reasoning',
        key: `${message.id}:reasoning:${index}`,
        text: reasoningPart.text,
        isStreaming:
          Boolean(isLatestStreaming) && reasoningPart.state === 'streaming',
      })
      return
    }

    if (part.type === 'text') {
      const text =
        message.role === 'user'
          ? stripGardenInternalDocumentContext(part.text ?? '')
          : (part.text ?? '')
      if (!text.trim()) return
      flushWork()
      nodes.push({
        kind: 'text',
        key: `${message.id}:text:${index}`,
        text,
      })
      return
    }

    if (isToolUIPart(part)) {
      const activity = getToolActivityItem({
        debugMode,
        index,
        messageId: message.id,
        part,
      })
      if (activity) {
        if (work.length === 0) workFirstIndex = index
        work.push(activity)
        workActive ||= activity.active
      }

      const payload = getToolOutputPayload(part)
      const artifact = normalizeGardenArtifact(payload)
      if (artifact) {
        flushWork()
        nodes.push({
          kind: 'artifact',
          key: `${message.id}:tool-artifact:${index}`,
          artifact,
        })
      }

      return
    }

    // Only data-artifact/data-graph/data-document-artifact parts actually
    // render (see renderArtifactPart). Everything else is invisible, so emit a
    // raw node — and disturb the work grouping — ONLY for those, instead of a
    // catch-all that flushed work for parts the renderer would drop to null.
    if (isRenderableArtifactPart(part)) {
      flushWork()
      nodes.push({
        kind: 'raw',
        key: `${message.id}:raw:${index}`,
        index,
        part,
      })
    }
  })

  flushWork()
  return nodes
}
