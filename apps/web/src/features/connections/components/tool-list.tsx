import {
  type ExecutorIntegrationTool,
  type ExecutorToolPreviewItem,
} from '@/lib/executor-contract'
import { formatToolName } from './connection-helpers'

export function PreviewToolList({
  tools,
}: {
  tools: readonly ExecutorToolPreviewItem[]
}) {
  return (
    <ul className="mt-3 divide-y divide-border/40">
      {tools.map((tool, index) => (
        <li key={`${tool.name}:${index}`} className="py-2.5">
          <span className="block text-sm font-medium text-foreground">
            {formatToolName(tool.name)}
          </span>
          {tool.description ? (
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
              {tool.description}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function PreviewToolSkeleton() {
  return (
    <div className="mt-3 space-y-3" aria-label="Loading tool preview">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="space-y-1.5 py-1">
          <div className="h-4 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted/70 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}

export function ToolList({
  tools,
}: {
  tools: readonly ExecutorIntegrationTool[]
}) {
  return (
    <ul className="mt-3">
      {tools.map((tool) => (
        <li
          key={tool.address}
          className="flex items-center justify-between gap-4 border-b border-border/40 py-2.5 last:border-b-0"
        >
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-sm text-foreground"
              title={tool.description || tool.name}
            >
              {formatToolName(tool.name)}
            </span>
            {tool.description ? (
              <span className="block truncate text-xs text-muted-foreground">
                {tool.description}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}
