/**
 * The graph artifact's canvas, in its own module so `@xyflow/react` (and its
 * stylesheet) load only when a chat actually contains a graph. It used to be
 * pulled into every chat through chat-artifacts.tsx.
 */
import type {
  Edge as FlowEdge,
  Node as FlowNode,
  NodeProps,
} from '@xyflow/react'
import { Badge } from '@garden/ui/components/ui/badge'
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

export default function ChatGraphCanvas({
  nodes,
  edges,
}: {
  nodes: FlowNode[]
  edges: FlowEdge[]
}) {
  return (
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
  )
}
