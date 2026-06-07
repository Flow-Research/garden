'use client'

/**
 * Chat message rendering subsystem.
 *
 * Extracted from `agent-interaction-screen.tsx` to keep the parent file
 * tractable. Owns:
 *
 *   - **Message rendering**: MessageSources, MessageArtifacts,
 *     MessageDocumentEdits, MessageOrderedParts, MessageCitations,
 *     MessageToolActivity, MessageToolApprovals.
 *   - **Streaming activity rows**: PreResponseWrapper, StreamingWorkSection,
 *     StreamingWorkEntryRow, PendingAssistantActivity.
 *   - **Tool / approval helpers**: toolStateLabel, productToolLabel,
 *     extractApprovalDescription, resolveToolApproval.
 *   - **Tracked-edit DOM helpers**: findOpenTrackedChangeElement,
 *     normalizeInlineText, applyOptimisticResolutionToOpenDocx,
 *     DocumentEditCard, DocumentEditCardsSection, ArtifactGraphNode,
 *     GardenDocDownloadBlock, renderArtifactPart, extractCitations.
 *   - **Shared types/helpers**: ChatWorkEntry, ToolActivityItem,
 *     DocumentEditItem, DocumentEditStatusMap, ApprovalGroup,
 *     ArtifactMessagePart; plus the JSON canonicalizer, approval input
 *     formatter, internal-document-context strippers, and the EXT_TO_LANG
 *     map used by code-block rendering.
 *
 * Anything specifically tied to the Composer or top-level
 * AgentInteractionScreen still lives in the parent file.
 */

import { useState } from 'react'
import { Result } from 'better-result'
import {
  getToolInput,
  getToolPartState,
} from '@cloudflare/ai-chat/react'
import { getToolName, isToolUIPart } from 'ai'
import { canonicalizeJson } from '@garden/connectors/capabilities'
import { isToolStateActive } from './chat-tool-state'
export { canonicalJsonString } from '@garden/connectors/capabilities'
import type {
  Edge as FlowEdge,
  Node as FlowNode,
  NodeProps,
} from '@xyflow/react'
import { Download, File as FileIcon } from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'
import { HoverCardTrigger } from '@garden/ui/components/ui/hover-card'
import { resolveDocumentEdit } from '@/lib/api'
import {
  Artifact,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from '@/components/ai-elements/artifact'
import { Canvas } from '@/components/ai-elements/canvas'
import { Connection } from '@/components/ai-elements/connection'
import { Controls } from '@/components/ai-elements/controls'
import { Edge as GraphEdge } from '@/components/ai-elements/edge'
import { MessageResponse } from '@/components/ai-elements/message'
import {
  Node as GraphNode,
  NodeContent,
  NodeDescription,
  NodeHeader,
  NodeTitle,
} from '@/components/ai-elements/node'
import { Panel } from '@/components/ai-elements/panel'
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources'
import { Toolbar } from '@/components/ai-elements/toolbar'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationQuote,
  InlineCitationSource,
} from '@/components/ai-elements/inline-citation'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ai-elements/code-block'
import {
  normalizeGardenArtifact,
  type GardenArtifactData,
} from '@/features/artifacts/artifact-renderer'
import type { ChatUiMessage } from '../chat-runtime-provider'
import {
  type DocumentCitationAnnotation,
  type DocumentEditAnnotation,
} from './chat-document-panel'
import {
  PreResponseWrapper,
  StreamingWorkEntryRow,
  productToolLabel,
  toolStateLabel,
} from './chat-tool-activity'
import {
  DocumentEditCard,
  applyOptimisticResolutionToOpenDocx,
} from './chat-tracked-edits'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ArtifactMessagePart = {
  type: string
  data?: Record<string, unknown>
}

export type ApprovalGroup = {
  approvalIds: string[]
  input: unknown
  key: string
  permissionRequestId?: string
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

export type DocumentEditItem = {
  annotation: DocumentEditAnnotation
  artifact: GardenArtifactData | null
  key: string
}

export type DocumentEditStatusMap = Record<string, 'pending' | 'accepted' | 'rejected'>

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
      ]
        .filter(Boolean)
        .join('\n\n')
    : toolStateLabel(state)

  return {
    active,
    detail,
    id: `${args.messageId}:tool:${args.index}`,
    input,
    label,
    output,
    state,
    tone: active ? 'tool' : 'info',
    toolName,
  }
}

export function getToolOutputPayload(part: ChatUiMessage['parts'][number]) {
  const record = part as unknown as Record<string, unknown>
  return typeof record.type === 'string' && record.type.startsWith('tool-')
    ? ((record.output ?? record.result) as Record<string, unknown> | null)
    : null
}

export function getDocumentEditItemsFromPart(args: {
  index: number
  messageId: string
  part: ChatUiMessage['parts'][number]
}): DocumentEditItem[] {
  const payload = getToolOutputPayload(args.part)
  const artifact = normalizeGardenArtifact(payload)
  const annotations = Array.isArray(payload?.annotations)
    ? payload.annotations
    : []
  return annotations.flatMap((annotation, annotationIndex) => {
    if (!annotation || typeof annotation !== 'object') return []
    const item = annotation as Record<string, unknown>
    if (
      typeof item.edit_id !== 'string' ||
      typeof item.document_id !== 'string'
    ) {
      return []
    }
    return [
      {
        annotation: {
          edit_id: item.edit_id,
          document_id: item.document_id,
          version_id:
            typeof item.version_id === 'string' ? item.version_id : null,
          version_number:
            typeof item.version_number === 'number'
              ? item.version_number
              : null,
          del_w_id: typeof item.del_w_id === 'string' ? item.del_w_id : null,
          ins_w_id: typeof item.ins_w_id === 'string' ? item.ins_w_id : null,
          inserted_text:
            typeof item.inserted_text === 'string'
              ? item.inserted_text
              : undefined,
          deleted_text:
            typeof item.deleted_text === 'string'
              ? item.deleted_text
              : undefined,
          reason: typeof item.reason === 'string' ? item.reason : undefined,
          status:
            item.status === 'accepted' ||
            item.status === 'rejected' ||
            item.status === 'pending'
              ? item.status
              : 'pending',
        } satisfies DocumentEditAnnotation,
        artifact,
        key: `${args.messageId}:edit:${args.index}:${annotationIndex}`,
      },
    ]
  })
}

export function inferLanguageFromFilename(filename: string | undefined | null): string | undefined {
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

export function MessageSources({ message }: { message: ChatUiMessage }) {
  const sourcePart = message.parts.find(
    (part) => part.type === 'data-sources',
  ) as
    | (ChatUiMessage['parts'][number] & {
        data?: { results?: unknown[] }
      })
    | undefined
  if (!sourcePart || !Array.isArray(sourcePart.data?.results)) return null

  const items = sourcePart.data.results.flatMap(
    (item: unknown, index: number) => {
      if (typeof item === 'string') {
        return [{ href: item, title: item, key: `${item}:${index}` }]
      }
      if (typeof item !== 'object' || item === null) return []

      const candidate = item as { url?: unknown; title?: unknown }
      if (typeof candidate.url !== 'string') return []

      return [
        {
          href: candidate.url,
          title:
            typeof candidate.title === 'string' && candidate.title
              ? candidate.title
              : candidate.url,
          key: `${candidate.url}:${index}`,
        },
      ]
    },
  )

  if (items.length === 0) return null

  return (
    <Sources className="mt-3">
      <SourcesTrigger count={items.length}>Sources</SourcesTrigger>
      <SourcesContent>
        {items.map((item: { href: string; title: string; key: string }) => (
          <Source key={item.key} href={item.href} title={item.title}>
            {item.title}
          </Source>
        ))}
      </SourcesContent>
    </Sources>
  )
}

function ArtifactGraphNode({
  data,
}: NodeProps<FlowNode<{ description?: string; title: string }>>) {
  return (
    <GraphNode handles={{ source: true, target: true }}>
      <NodeHeader>
        <NodeTitle>{data.title}</NodeTitle>
        {data.description ? (
          <NodeDescription>{data.description}</NodeDescription>
        ) : null}
      </NodeHeader>
      <NodeContent className="text-xs text-muted-foreground">
        Drag to rearrange
      </NodeContent>
      <Toolbar>
        <Badge variant="secondary" className="rounded-sm px-1.5 py-0">
          Node
        </Badge>
      </Toolbar>
    </GraphNode>
  )
}

function GardenDocDownloadBlock({
  artifact,
  onOpen,
}: {
  artifact: GardenArtifactData
  onOpen?: () => void
}) {
  const filename = artifact.filename
  const parts = filename.split('.')
  const ext = parts.length > 1 ? (parts.at(-1) ?? 'file').toUpperCase() : 'FILE'
  const basename = parts.length > 1 ? parts.slice(0, -1).join('.') : filename
  const versionNumber = artifact.versionNumber ?? null
  const hasVersion =
    typeof versionNumber === 'number' &&
    Number.isFinite(versionNumber) &&
    versionNumber > 0

  const body = (
    <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="text-wrap font-serif text-base text-foreground">
            {basename}
          </p>
          {hasVersion ? (
            <span className="inline-flex shrink-0 items-center rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              V{versionNumber}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-blue-500">{ext}</p>
      </div>
    </div>
  )

  const downloadIcon = artifact.url ? (
    <a
      href={artifact.url}
      download={filename}
      onClick={(event) => event.stopPropagation()}
      className="flex shrink-0 cursor-pointer items-center border-l border-border bg-background px-6 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground"
    >
      <Download size={13} />
    </a>
  ) : (
    <div
      aria-disabled
      className="flex shrink-0 cursor-not-allowed items-center border-l border-border bg-background px-6 text-muted-foreground/40"
    >
      <Download size={13} />
    </div>
  )

  if (onOpen) {
    return (
      <div className="flex w-full items-stretch overflow-hidden rounded-lg border border-border bg-muted font-sans">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-stretch text-left transition-colors hover:bg-accent"
        >
          {body}
        </button>
        {downloadIcon}
      </div>
    )
  }

  return (
    <div className="flex w-full items-stretch overflow-hidden rounded-lg border border-border bg-muted font-sans">
      {body}
      {downloadIcon}
    </div>
  )
}

export function MessageArtifacts({
  message,
  onOpenDocument,
}: {
  message: ChatUiMessage
  onOpenDocument?: (artifact: GardenArtifactData) => void
}) {
  const gardenArtifacts = message.parts.flatMap((part, index) => {
    const record = part as unknown as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    const payload =
      type === 'data-document-artifact' || type === 'data-artifact'
        ? record.data
        : type.startsWith('tool-')
          ? (record.output ?? record.result)
          : null
    const artifact = normalizeGardenArtifact(payload)
    return artifact ? [{ artifact, key: `${message.id}:garden:${index}` }] : []
  })
  const artifactParts = message.parts.filter(
    (part) => part.type === 'data-artifact' || part.type === 'data-graph',
  ) as ArtifactMessagePart[]

  if (artifactParts.length === 0 && gardenArtifacts.length === 0) return null

  return (
    <div className="mt-3 space-y-3">
      {gardenArtifacts.map((item) => (
        <GardenDocDownloadBlock
          key={item.key}
          artifact={item.artifact}
          onOpen={
            onOpenDocument ? () => onOpenDocument(item.artifact) : undefined
          }
        />
      ))}
      {artifactParts.map((part, index) => {
        if (normalizeGardenArtifact(part.data)) return null
        if (part.type === 'data-graph') {
          const rawNodes = Array.isArray(part.data?.nodes)
            ? (part.data.nodes as Array<Record<string, unknown>>)
            : []
          const rawEdges = Array.isArray(part.data?.edges)
            ? (part.data.edges as Array<Record<string, unknown>>)
            : []

          const nodes: FlowNode[] = rawNodes.map((node, nodeIndex) => ({
            id:
              typeof node.id === 'string'
                ? node.id
                : `node-${message.id}-${nodeIndex}`,
            position: {
              x: typeof node.x === 'number' ? node.x : nodeIndex * 220,
              y:
                typeof node.y === 'number'
                  ? node.y
                  : 40 + (nodeIndex % 2) * 140,
            },
            data: {
              title:
                typeof node.title === 'string'
                  ? node.title
                  : `Node ${nodeIndex + 1}`,
              description:
                typeof node.description === 'string'
                  ? node.description
                  : undefined,
            },
            type: 'artifactNode',
          }))

          const edges: FlowEdge[] = rawEdges.flatMap((edge, edgeIndex) => {
            if (
              typeof edge.source !== 'string' ||
              typeof edge.target !== 'string'
            ) {
              return []
            }
            return [
              {
                id:
                  typeof edge.id === 'string'
                    ? edge.id
                    : `edge-${message.id}-${edgeIndex}`,
                source: edge.source,
                target: edge.target,
                type: 'animatedEdge',
              } satisfies FlowEdge,
            ]
          })

          return (
            <Artifact key={`${message.id}:${part.type}:${index}`}>
              <ArtifactHeader>
                <div>
                  <ArtifactTitle>
                    {typeof part.data?.title === 'string'
                      ? part.data.title
                      : 'Graph'}
                  </ArtifactTitle>
                  {typeof part.data?.description === 'string' ? (
                    <ArtifactDescription>
                      {part.data.description}
                    </ArtifactDescription>
                  ) : null}
                </div>
              </ArtifactHeader>
              <ArtifactContent className="p-0">
                <div className="h-[360px] w-full">
                  <Canvas
                    nodes={nodes}
                    edges={edges}
                    edgeTypes={{ animatedEdge: GraphEdge.Animated }}
                    nodeTypes={{ artifactNode: ArtifactGraphNode }}
                    connectionLineComponent={Connection}
                  >
                    <Controls />
                    <Panel position="top-left">
                      <Badge variant="secondary" className="rounded-md">
                        Canvas
                      </Badge>
                    </Panel>
                  </Canvas>
                </div>
              </ArtifactContent>
            </Artifact>
          )
        }

        return (
          <Artifact key={`${message.id}:${part.type}:${index}`}>
            <ArtifactHeader>
              <div>
                <ArtifactTitle>
                  {typeof part.data?.title === 'string'
                    ? part.data.title
                    : 'Artifact'}
                </ArtifactTitle>
                {typeof part.data?.description === 'string' ? (
                  <ArtifactDescription>
                    {part.data.description}
                  </ArtifactDescription>
                ) : null}
              </div>
            </ArtifactHeader>
            <ArtifactContent>
              <div className="text-sm leading-relaxed text-muted-foreground">
                {typeof part.data?.content === 'string'
                  ? part.data.content
                  : JSON.stringify(part.data ?? {}, null, 2)}
              </div>
            </ArtifactContent>
          </Artifact>
        )
      })}
    </div>
  )
}

export function MessageDocumentEdits({
  edits: explicitEdits,
  message,
  onResolveError,
  onResolveStart,
  resolvedStatuses,
  onOpenEdit,
  onResolved,
}: {
  edits?: DocumentEditItem[]
  message: ChatUiMessage
  onResolveError?: (editId: string) => void
  onResolveStart?: (editId: string, status: 'accepted' | 'rejected') => void
  resolvedStatuses?: DocumentEditStatusMap
  onOpenEdit?: (
    annotation: DocumentEditAnnotation,
    artifact: GardenArtifactData,
  ) => void
  onResolved?: (editId: string, status: 'accepted' | 'rejected') => void
}) {
  const edits =
    explicitEdits ??
    message.parts.flatMap((part, index) =>
      getDocumentEditItemsFromPart({ index, messageId: message.id, part }),
    )

  if (edits.length === 0) return null

  return (
    <DocumentEditCardsSection
      edits={edits}
      onOpenEdit={onOpenEdit}
      onResolveError={onResolveError}
      onResolveStart={onResolveStart}
      onResolved={onResolved}
      resolvedStatuses={resolvedStatuses}
    />
  )
}

function DocumentEditCardsSection({
  edits,
  onOpenEdit,
  onResolveError,
  onResolveStart,
  onResolved,
  resolvedStatuses,
}: {
  edits: DocumentEditItem[]
  onOpenEdit?: (
    annotation: DocumentEditAnnotation,
    artifact: GardenArtifactData,
  ) => void
  onResolveError?: (editId: string) => void
  onResolveStart?: (editId: string, status: 'accepted' | 'rejected') => void
  onResolved?: (editId: string, status: 'accepted' | 'rejected') => void
  resolvedStatuses?: DocumentEditStatusMap
}) {
  const [busyEditIds, setBusyEditIds] = useState<string[]>([])
  const resolvedEdits = edits.map((edit) => ({
    ...edit,
    annotation: {
      ...edit.annotation,
      status:
        resolvedStatuses?.[edit.annotation.edit_id] ?? edit.annotation.status,
    },
  }))
  const pendingEdits = resolvedEdits.filter(
    ({ annotation }) => annotation.status === 'pending',
  )
  const busy = busyEditIds.length > 0

  const resolveOne = async (
    edit: DocumentEditItem,
    verb: 'accept' | 'reject',
  ) => {
    const editId = edit.annotation.edit_id
    const nextStatus = verb === 'accept' ? 'accepted' : 'rejected'
    setBusyEditIds((current) => [...new Set([...current, editId])])
    onResolveStart?.(editId, nextStatus)
    const revert = applyOptimisticResolutionToOpenDocx(edit.annotation, verb)
    const result = await Result.tryPromise({
      try: async () => {
        return await resolveDocumentEdit({
          action: verb,
          documentId: edit.annotation.document_id,
          editId,
        })
      },
      catch: () => new Error('Could not resolve edit.'),
    })
    if (result.isOk()) {
      onResolved?.(editId, nextStatus)
    } else {
      revert()
      onResolveError?.(editId)
    }
    setBusyEditIds((current) => current.filter((id) => id !== editId))
  }

  const resolveAll = async (verb: 'accept' | 'reject') => {
    for (const edit of pendingEdits) {
      await resolveOne(edit, verb)
    }
  }

  return (
    <div className="mt-2.5 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <p className="text-xs font-medium text-foreground/80">Tracked Changes</p>
        <p className="ml-auto text-xs text-muted-foreground">
          {pendingEdits.length} pending
        </p>
      </div>
      {pendingEdits.length > 1 ? (
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <button
            type="button"
            onClick={() => void resolveAll('accept')}
            disabled={busy}
            className="px-2 py-1 text-xs rounded border border-foreground bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={() => void resolveAll('reject')}
            disabled={busy}
            className="px-2 py-1 text-xs rounded border border-border bg-card text-foreground/80 hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1"
          >
            Reject all
          </button>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 px-3 pb-2.5 pt-2.5">
        {resolvedEdits.map(({ key, annotation, artifact }) => (
          <DocumentEditCard
            key={key}
            annotation={annotation}
            busy={busyEditIds.includes(annotation.edit_id)}
            onResolveError={onResolveError}
            onResolveStart={onResolveStart}
            onView={
              onOpenEdit && artifact
                ? () => onOpenEdit(annotation, artifact)
                : undefined
            }
            onResolved={onResolved}
          />
        ))}
      </div>
    </div>
  )
}

export function MessageOrderedParts({
  debugMode,
  isLatestStreaming,
  message,
  onOpenDocument,
  onOpenEdit,
  onResolveError,
  onResolveStart,
  onResolved,
  resolvedStatuses,
}: {
  debugMode: boolean
  isLatestStreaming?: boolean
  message: ChatUiMessage
  onOpenDocument?: (artifact: GardenArtifactData) => void
  onOpenEdit?: (
    annotation: DocumentEditAnnotation,
    artifact: GardenArtifactData,
  ) => void
  onResolveError?: (editId: string) => void
  onResolveStart?: (editId: string, status: 'accepted' | 'rejected') => void
  onResolved?: (editId: string, status: 'accepted' | 'rejected') => void
  resolvedStatuses?: DocumentEditStatusMap
}) {
  const lastPartIndex = message.parts.length - 1
  const rendered: React.ReactNode[] = []
  let workItems: React.ReactNode[] = []
  let workCount = 0
  let workActive = false

  const flushWork = () => {
    if (workItems.length === 0) return
    rendered.push(
      <PreResponseWrapper
        key={`${message.id}:work:${rendered.length}`}
        isStreaming={workActive}
        shouldMinimize={false}
        stepCount={workCount}
      >
        {workItems}
      </PreResponseWrapper>,
    )
    workItems = []
    workCount = 0
    workActive = false
  }

  message.parts.forEach((part, index) => {
    if (part.type === 'reasoning') {
      flushWork()
      if (!debugMode) return
      const reasoningPart = part as { type: 'reasoning'; text: string }
      if (reasoningPart.text.trim()) {
        rendered.push(
          <Reasoning
            key={`${message.id}:reasoning:${index}`}
            isStreaming={index === message.parts.length - 1}
            className="w-full"
          >
            <ReasoningTrigger />
            <ReasoningContent>{reasoningPart.text}</ReasoningContent>
          </Reasoning>,
        )
      }
      return
    }

    if (part.type === 'text') {
      const text =
        message.role === 'user'
          ? stripGardenInternalDocumentContext(part.text ?? '')
          : (part.text ?? '')
      if (!text.trim()) return
      flushWork()
      const isAnimatingText =
        Boolean(isLatestStreaming) &&
        message.role === 'assistant' &&
        index === lastPartIndex
      rendered.push(
        <MessageResponse
          key={`${message.id}:text:${index}`}
          isAnimating={isAnimatingText}
          animated={isAnimatingText ? { animation: 'fadeIn', sep: 'word' } : false}
        >
          {text}
        </MessageResponse>,
      )
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
        workCount += 1
        workActive ||= activity.active
        workItems.push(
          <StreamingWorkEntryRow
            key={activity.id}
            entry={activity}
            showConnector={false}
          />,
        )
      }

      const payload = getToolOutputPayload(part)
      const artifact = normalizeGardenArtifact(payload)
      if (artifact) {
        flushWork()
        rendered.push(
          <GardenDocDownloadBlock
            key={`${message.id}:tool-artifact:${index}`}
            artifact={artifact}
            onOpen={onOpenDocument ? () => onOpenDocument(artifact) : undefined}
          />,
        )
      }

      const edits = getDocumentEditItemsFromPart({
        index,
        messageId: message.id,
        part,
      })
      if (edits.length > 0) {
        flushWork()
        rendered.push(
          <DocumentEditCardsSection
            key={`${message.id}:tool-edits:${index}`}
            edits={edits}
            onOpenEdit={onOpenEdit}
            onResolveError={onResolveError}
            onResolveStart={onResolveStart}
            onResolved={onResolved}
            resolvedStatuses={resolvedStatuses}
          />,
        )
      }
      return
    }

    flushWork()
    const artifact = renderArtifactPart({
      index,
      messageId: message.id,
      onOpenDocument,
      part,
    })
    if (artifact) rendered.push(artifact)
  })

  flushWork()

  if (rendered.length === 0) return null
  return <>{rendered}</>
}

function renderArtifactPart(args: {
  index: number
  messageId: string
  onOpenDocument?: (artifact: GardenArtifactData) => void
  part: ChatUiMessage['parts'][number]
}) {
  const record = args.part as unknown as ArtifactMessagePart
  if (record.type !== 'data-artifact' && record.type !== 'data-graph') {
    const dataRecord = args.part as unknown as Record<string, unknown>
    if (dataRecord.type !== 'data-document-artifact') return null
  }

  const gardenArtifact = normalizeGardenArtifact(record.data)
  if (gardenArtifact) {
    return (
      <GardenDocDownloadBlock
        key={`${args.messageId}:garden:${args.index}`}
        artifact={gardenArtifact}
        onOpen={
          args.onOpenDocument
            ? () => args.onOpenDocument?.(gardenArtifact)
            : undefined
        }
      />
    )
  }

  if (record.type === 'data-graph') {
    const rawNodes = Array.isArray(record.data?.nodes)
      ? (record.data.nodes as Array<Record<string, unknown>>)
      : []
    const rawEdges = Array.isArray(record.data?.edges)
      ? (record.data.edges as Array<Record<string, unknown>>)
      : []
    const nodes: FlowNode[] = rawNodes.map((node, nodeIndex) => ({
      id:
        typeof node.id === 'string'
          ? node.id
          : `node-${args.messageId}-${nodeIndex}`,
      position: {
        x: typeof node.x === 'number' ? node.x : nodeIndex * 220,
        y: typeof node.y === 'number' ? node.y : 40 + (nodeIndex % 2) * 140,
      },
      data: {
        title:
          typeof node.title === 'string' ? node.title : `Node ${nodeIndex + 1}`,
        description:
          typeof node.description === 'string' ? node.description : undefined,
      },
      type: 'artifactNode',
    }))
    const edges: FlowEdge[] = rawEdges.flatMap((edge, edgeIndex) => {
      if (typeof edge.source !== 'string' || typeof edge.target !== 'string') {
        return []
      }
      return [
        {
          id:
            typeof edge.id === 'string'
              ? edge.id
              : `edge-${args.messageId}-${edgeIndex}`,
          source: edge.source,
          target: edge.target,
          type: 'animatedEdge',
        } satisfies FlowEdge,
      ]
    })

    return (
      <Artifact key={`${args.messageId}:${record.type}:${args.index}`}>
        <ArtifactHeader>
          <div>
            <ArtifactTitle>
              {typeof record.data?.title === 'string'
                ? record.data.title
                : 'Graph'}
            </ArtifactTitle>
            {typeof record.data?.description === 'string' ? (
              <ArtifactDescription>
                {record.data.description}
              </ArtifactDescription>
            ) : null}
          </div>
        </ArtifactHeader>
        <ArtifactContent className="p-0">
          <div className="h-[360px] w-full">
            <Canvas
              nodes={nodes}
              edges={edges}
              edgeTypes={{ animatedEdge: GraphEdge.Animated }}
              nodeTypes={{ artifactNode: ArtifactGraphNode }}
              connectionLineComponent={Connection}
            >
              <Controls />
              <Panel position="top-left">
                <Badge variant="secondary" className="rounded-md">
                  Canvas
                </Badge>
              </Panel>
            </Canvas>
          </div>
        </ArtifactContent>
      </Artifact>
    )
  }

  const artifactTitle =
    typeof record.data?.title === 'string' ? record.data.title : 'Artifact'
  const artifactFilename =
    typeof record.data?.filename === 'string' ? record.data.filename : undefined
  const artifactLang =
    (typeof record.data?.language === 'string'
      ? record.data.language
      : undefined) ?? inferLanguageFromFilename(artifactFilename)
  const artifactContent =
    typeof record.data?.content === 'string'
      ? record.data.content
      : JSON.stringify(record.data ?? {}, null, 2)

  if (artifactLang) {
    return (
      <CodeBlock
        key={`${args.messageId}:${record.type}:${args.index}`}
        code={artifactContent}
        language={artifactLang as import('shiki').BundledLanguage}
      >
        <CodeBlockHeader>
          <CodeBlockTitle>
            <FileIcon size={14} />
            <CodeBlockFilename>
              {artifactFilename ?? artifactTitle}
            </CodeBlockFilename>
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
    )
  }

  return (
    <Artifact key={`${args.messageId}:${record.type}:${args.index}`}>
      <ArtifactHeader>
        <div>
          <ArtifactTitle>{artifactTitle}</ArtifactTitle>
          {typeof record.data?.description === 'string' ? (
            <ArtifactDescription>{record.data.description}</ArtifactDescription>
          ) : null}
        </div>
      </ArtifactHeader>
      <ArtifactContent>
        <div className="text-sm leading-relaxed text-muted-foreground">
          {artifactContent}
        </div>
      </ArtifactContent>
    </Artifact>
  )
}

function extractCitations(message: ChatUiMessage) {
  return message.parts.flatMap((part, index) => {
    const record = part as unknown as Record<string, unknown>
    const payloads = [record.data, record.output, record.result, record].filter(
      (value): value is Record<string, unknown> =>
        Boolean(value && typeof value === 'object'),
    )
    return payloads.flatMap((payload, payloadIndex) => {
      const annotations = Array.isArray(payload.annotations)
        ? payload.annotations
        : Array.isArray(payload.citations)
          ? payload.citations
          : []
      return annotations.flatMap((annotation, annotationIndex) => {
        if (!annotation || typeof annotation !== 'object') return []
        const item = annotation as Record<string, unknown>
        const kind = item.kind ?? item.type
        if (kind !== 'citation' && kind !== 'citation_data') return []
        if (
          typeof item.document_id !== 'string' ||
          typeof item.filename !== 'string' ||
          typeof item.quote !== 'string'
        ) {
          return []
        }
        return [
          {
            key: `${message.id}:citation:${index}:${payloadIndex}:${annotationIndex}`,
            citation: {
              document_id: item.document_id,
              filename: item.filename,
              page:
                typeof item.page === 'number' || typeof item.page === 'string'
                  ? item.page
                  : null,
              quote: item.quote,
              ref: typeof item.ref === 'number' ? item.ref : null,
              version_id:
                typeof item.version_id === 'string' ? item.version_id : null,
              version_number:
                typeof item.version_number === 'number'
                  ? item.version_number
                  : null,
            } satisfies DocumentCitationAnnotation,
          },
        ]
      })
    })
  })
}

export function MessageCitations({
  message,
  onOpenCitation,
}: {
  message: ChatUiMessage
  onOpenCitation?: (citation: DocumentCitationAnnotation) => void
}) {
  const citations = extractCitations(message)

  if (citations.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {citations.map(({ key, citation }, index) => {
        const quotePreview = citation.quote
          .replaceAll('[[PAGE_BREAK]]', '...')
          .slice(0, 120)
        const pageLabel =
          citation.page != null ? ` · p.${citation.page}` : ''

        return (
          <InlineCitation key={key}>
            <InlineCitationCard>
              <HoverCardTrigger
                render={
                  <button
                    type="button"
                    onClick={() => onOpenCitation?.(citation)}
                    className="inline-flex h-5 min-w-5 cursor-pointer items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80"
                  />
                }
              >
                {citation.ref ?? index + 1}
              </HoverCardTrigger>
              <InlineCitationCardBody>
                <div className="space-y-2 p-3">
                  <InlineCitationSource
                    title={citation.filename}
                    description={`${citation.document_id}${pageLabel}`}
                  />
                  {quotePreview ? (
                    <InlineCitationQuote>
                      {quotePreview}
                      {citation.quote.length > 120 ? '…' : ''}
                    </InlineCitationQuote>
                  ) : null}
                </div>
              </InlineCitationCardBody>
            </InlineCitationCard>
          </InlineCitation>
        )
      })}
    </div>
  )
}
