'use client'

/**
 * Artifact rendering for chat messages: garden document download blocks, code
 * blocks, and graph/canvas artifacts. Split out of chat-message-parts.tsx;
 * consumed by MessageOrderedParts via GardenDocDownloadBlock (artifact node) and
 * renderArtifactPart (raw data-artifact/data-graph node).
 */
import type {
  Edge as FlowEdge,
  Node as FlowNode,
  NodeProps,
} from '@xyflow/react'
import { Download, File as FileIcon } from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'
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
import {
  Node as GraphNode,
  NodeContent,
  NodeDescription,
  NodeHeader,
  NodeTitle,
} from '@/components/ai-elements/node'
import { Panel } from '@/components/ai-elements/panel'
import { Toolbar } from '@/components/ai-elements/toolbar'
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
  inferLanguageFromFilename,
  type ArtifactMessagePart,
} from './chat-message-model'

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

export function GardenDocDownloadBlock({
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


export function renderArtifactPart(args: {
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

