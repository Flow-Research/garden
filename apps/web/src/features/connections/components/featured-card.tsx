import { useEffect, useRef, type ReactNode } from 'react'
import { type ExecutorIntegrationItem } from '@/lib/executor-contract'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { type ProviderCardEntry, statusDotColor } from './connection-helpers'
import { ProviderIcon } from './provider-icon'

export function FeaturedCard({
  entry,
  integration,
  highlighted,
  busy,
  onInspect,
  onManage,
}: {
  entry: ProviderCardEntry
  integration: ExecutorIntegrationItem | null
  highlighted: boolean
  busy: boolean
  onInspect: () => void
  onManage: () => void
}) {
  const cardRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const connected = integration?.status === 'connected'
  const degraded = integration?.status === 'degraded'
  const installed = integration !== null
  let actionContent: ReactNode = 'Connect'
  if (installed) actionContent = 'Manage'
  if (busy) {
    actionContent = (
      <>
        <Spinner className="size-3" />
        Connecting…
      </>
    )
  }
  let statusText = 'setup required'
  if (connected) statusText = 'connected'
  if (degraded) statusText = 'needs attention'

  return (
    <li
      ref={cardRef}
      className={[
        'flex flex-col rounded-xl border bg-background p-2.5 transition-colors motion-reduce:transition-none',
        highlighted ? 'border-success/50' : 'border-border/60',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40">
          <ProviderIcon icon={entry.icon} className="size-4.5 object-contain" />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {entry.name}
        </h3>
      </div>
      <p className="mt-0.5 mb-2 h-8 flex-1 overflow-hidden text-xs leading-4 text-muted-foreground">
        {entry.description}
      </p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            size="sm"
            variant={installed ? 'outline' : 'default'}
            className="h-7 text-xs"
            disabled={busy}
            onClick={installed ? onManage : onInspect}
          >
            {actionContent}
          </Button>
          {installed ? (
            <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-muted/40 px-2 text-[11px] font-medium text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${statusDotColor(integration.status)}`}
              />
              {statusText}
            </span>
          ) : null}
        </div>
        {integration && integration.tools.length > 0 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {integration.tools.length} tools
          </span>
        ) : null}
      </div>
    </li>
  )
}

export function FeaturedSkeleton() {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2"
      aria-hidden="true"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-36 animate-pulse rounded-xl border border-border/40 bg-muted/20"
        />
      ))}
    </div>
  )
}
