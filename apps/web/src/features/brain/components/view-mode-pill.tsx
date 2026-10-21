import type { ReactNode } from 'react'
import { List, LayoutGrid } from 'lucide-react'

/** Section layout driven by the design's squares-four/list-dashes toggles. */
export type ViewMode = 'grid' | 'list'

/**
 * Segmented grid/list view toggle from the Penpot headers (74×40 pill, active
 * segment on the raised surface): squares-four for the card grid, list-dashes
 * for full-width rows. Extracted from files-page so the folder detail toolbar
 * (Penpot folder frame shows the same pill right of Export Data) reuses the
 * exact control instead of growing a second variant.
 */
export function ViewModePill({
  mode,
  onChange,
  label,
}: {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
  label: string
}) {
  const segment = (segmentMode: ViewMode, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={mode === segmentMode}
      aria-label={`${label}: ${segmentMode} view`}
      onClick={() => onChange(segmentMode)}
      className={
        mode === segmentMode
          ? 'flex size-8 cursor-pointer items-center justify-center rounded-md bg-background-main-default text-icon-neutral-default'
          : 'flex size-8 cursor-pointer items-center justify-center rounded-md text-icon-neutral-secondary transition-colors hover:text-icon-neutral-default'
      }
    >
      {icon}
    </button>
  )

  return (
    <div
      role="group"
      aria-label={`${label} view mode`}
      className="flex h-10 items-center gap-1 rounded-lg bg-background-main-secondary p-1"
    >
      {segment('grid', <LayoutGrid className="size-4" />)}
      {segment('list', <List className="size-4" />)}
    </div>
  )
}
