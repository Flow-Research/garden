'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitPullRequest,
  History,
  ListChecks,
  MessageSquare,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import { ConnectorIcon } from './connector-icon'
import { Markdown } from '@/features/common/markdown'

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkProductType =
  | 'brief'
  | 'plan'
  | 'connector_reply'
  | 'pull_request'
  | 'report'
  | 'checklist'

export type WorkProductStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'applied'
  | 'superseded'

export type WorkProductReviewState = 'pending' | 'approved' | 'changes_requested'

export interface WorkProductCardProps {
  workProduct: {
    id: string
    type: WorkProductType
    status: WorkProductStatus
    review_state: WorkProductReviewState
    is_primary: boolean
    title: string
    body: string
    applied_external_url: string | null
    previous_versions_count: number
    updated_at: string
  }
  /** When set, shows an Apply button + connector icon. */
  connectorId?: string | null
  /** When true, the card briefly pulses on mount — used by ?focus=wp_review deep links. */
  pulseOnMount?: boolean
  onApprove?: () => void
  onRequestChanges?: () => void
  onApply?: () => void
  onShowDiff?: () => void
}

const TYPE_ICON: Record<WorkProductType, React.ComponentType<{ className?: string }>> = {
  brief: FileText,
  plan: ListChecks,
  connector_reply: MessageSquare,
  pull_request: GitPullRequest,
  report: FileText,
  checklist: ListChecks,
}

const TYPE_LABEL: Record<WorkProductType, string> = {
  brief: 'Brief',
  plan: 'Plan',
  connector_reply: 'Reply',
  pull_request: 'PR',
  report: 'Report',
  checklist: 'Checklist',
}

// ─── Status pill ─────────────────────────────────────────────────────────────
//
// Tinted Badge per status, sized to the work-product card's compact header.

const STATUS_BADGE_CLASS: Record<WorkProductStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  review: 'bg-warning/15 text-warning',
  approved: 'bg-info/15 text-info',
  applied: 'bg-success/15 text-success',
  superseded: 'bg-muted/50 text-muted-foreground/70 line-through',
}

function StatusPill({ status }: { status: WorkProductStatus }) {
  return (
    <Badge
      className={cn(
        'h-4 rounded px-1.5 text-[10px] uppercase tracking-wide',
        STATUS_BADGE_CLASS[status],
      )}
    >
      {status}
    </Badge>
  )
}

// ─── Markdown body ───────────────────────────────────────────────────────────

function MarkdownBody({ body, expanded }: { body: string; expanded: boolean }) {
  return (
    <div
      className={cn(
        'text-sm leading-relaxed',
        !expanded && 'line-clamp-6',
      )}
    >
      <Markdown mode="minimal">{body}</Markdown>
    </div>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function WorkProductCard({
  workProduct,
  connectorId,
  pulseOnMount = false,
  onApprove,
  onRequestChanges,
  onApply,
  onShowDiff,
}: WorkProductCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [pulse, setPulse] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const TypeIcon = TYPE_ICON[workProduct.type]
  const isSuperseded = workProduct.status === 'superseded'

  const showReviewActions = workProduct.status === 'review' && workProduct.review_state === 'pending'
  const showApply =
    workProduct.status === 'approved' &&
    !workProduct.applied_external_url &&
    connectorId

  useEffect(() => {
    if (!pulseOnMount) return
    setPulse(true)
    const node = ref.current
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setPulse(false), 1800)
    return () => clearTimeout(timer)
  }, [pulseOnMount])

  return (
    <div
      ref={ref}
      id={`work-product-${workProduct.id}`}
      className={cn(
        'rounded-lg border transition-shadow',
        isSuperseded && 'opacity-60 border-dashed',
        workProduct.status === 'review' && 'border-warning/30 bg-warning/[0.03]',
        workProduct.status === 'approved' && 'border-info/20 bg-info/[0.03]',
        workProduct.status === 'applied' && 'border-success/20 bg-success/[0.03]',
        (workProduct.status === 'draft' || workProduct.status === 'superseded') && 'border-border bg-card',
        pulse && 'ring-2 ring-brand/60 ring-offset-2 ring-offset-background',
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-2">
        <TypeIcon
          aria-label={TYPE_LABEL[workProduct.type]}
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <h4 className="flex-1 min-w-0 text-sm font-semibold text-foreground leading-snug">
              {workProduct.title}
            </h4>
            <StatusPill status={workProduct.status} />
          </div>
          {(workProduct.previous_versions_count > 0 || connectorId) && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              {workProduct.previous_versions_count > 0 && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={onShowDiff}
                  className="h-4 px-1 text-[10px] text-muted-foreground"
                >
                  <History />
                  v{workProduct.previous_versions_count + 1} ({workProduct.previous_versions_count} prev)
                </Button>
              )}
              {connectorId && (
                <ConnectorIcon connectorId={connectorId} className="text-muted-foreground" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-3">
        <MarkdownBody body={workProduct.body} expanded={expanded} />
        {workProduct.body.trim().length > 0 && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 h-5 px-1 text-xs text-muted-foreground"
          >
            {expanded ? 'Show less' : 'Show more'}
          </Button>
        )}
      </div>

      {/* Footer / actions */}
      {showReviewActions && (
        <div className="flex items-center gap-2 border-t border-warning/15 px-4 py-2.5">
          <Button size="sm" className="h-7" onClick={onApprove}>
            <Check className="h-3.5 w-3.5 mr-1" />
            Approve
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={onRequestChanges}>
            Request changes
          </Button>
        </div>
      )}

      {showApply && (
        <div className="flex items-center gap-2 border-t border-info/15 px-4 py-2.5">
          <Button size="sm" className="h-7" onClick={onApply}>
            <Send className="h-3.5 w-3.5 mr-1" />
            Apply{connectorId === 'github' ? ' to GitHub' : ''}
          </Button>
          <span className="text-xs text-muted-foreground">
            Posts to the connector under your account.
          </span>
        </div>
      )}

      {workProduct.status === 'applied' && workProduct.applied_external_url && (
        <div className="flex items-center gap-2 border-t border-success/15 px-4 py-2.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          <a
            href={workProduct.applied_external_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-success hover:underline inline-flex items-center gap-1"
          >
            View on connector
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {workProduct.review_state === 'changes_requested' && workProduct.status !== 'superseded' && (
        <div className="flex items-center gap-2 border-t border-warning/15 px-4 py-2 text-xs text-warning">
          <X className="h-3.5 w-3.5" />
          Changes requested. Bot will revise on next run.
        </div>
      )}
    </div>
  )
}

// ─── List wrapper ────────────────────────────────────────────────────────────

interface WorkProductListProps {
  workProducts: WorkProductCardProps['workProduct'][]
  connectorId?: string | null
  /** ID of the card to pulse on mount (e.g. from `?focus=wp_review:<id>`). */
  pulseId?: string | null
  onApprove?: (id: string) => void
  onRequestChanges?: (id: string) => void
  onApply?: (id: string) => void
}

export function WorkProductList({
  workProducts,
  connectorId,
  pulseId,
  onApprove,
  onRequestChanges,
  onApply,
}: WorkProductListProps) {
  if (workProducts.length === 0) return null

  return (
    <div className="space-y-2">
      {workProducts.map((wp) => (
        <WorkProductCard
          key={wp.id}
          workProduct={wp}
          connectorId={connectorId}
          pulseOnMount={pulseId === wp.id}
          onApprove={() => onApprove?.(wp.id)}
          onRequestChanges={() => onRequestChanges?.(wp.id)}
          onApply={() => onApply?.(wp.id)}
        />
      ))}
    </div>
  )
}

export function WorkProductListEmpty({
  message = 'Bot will produce briefs, plans, and drafts here as it works.',
}: {
  message?: string
}) {
  return (
    <Empty className="border px-4 py-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Sparkles />
        </EmptyMedia>
        <EmptyTitle>No work products yet</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
