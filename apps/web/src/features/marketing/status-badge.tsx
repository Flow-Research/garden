import { cn } from '@garden/ui/lib/utils'
import type { FeatureStatus } from './feature-copy'
import { featuresPageCopy } from './feature-copy'

const statusStyles: Record<FeatureStatus, string> = {
  shipped:
    'bg-[color-mix(in_srgb,var(--moss)_12%,transparent)] text-[color:var(--moss)]',
  building:
    'bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] text-[color:var(--amber)]',
  planned: 'bg-muted text-muted-foreground',
  later: 'bg-muted/60 text-muted-foreground',
}

/** Compact status pill used in tables and feature headers. */
export function StatusBadge({ status }: { status: FeatureStatus }) {
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
        statusStyles[status],
      )}
    >
      {featuresPageCopy.statusLabels[status]}
    </span>
  )
}

/**
 * Secondary tag marking a ledger row whose copy was recently added or revised.
 * Outlined (not filled) so it reads as meta about the entry, distinct from the
 * filled status pill it sits next to.
 */
export function UpdatedBadge() {
  return (
    <span className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-[color:var(--hairline-soft)]">
      Updated
    </span>
  )
}
