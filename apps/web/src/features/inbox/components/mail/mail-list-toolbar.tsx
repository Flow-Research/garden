// Filter/selection composition adapts Zero (MIT) and Cloudflare Agentic Inbox (Apache-2.0).
// See THIRD_PARTY_NOTICES.md.

import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Switch } from '@garden/ui/components/ui/switch'
import { cn } from '@garden/ui/lib/utils'
import { Filter, Search, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { MailScopeTabs } from './mail-scope-tabs'
import type { MailScope } from './types'

export type MailListToolbarProps = {
  scope: MailScope
  search: string
  unreadOnly: boolean
  selectedCount: number
  filterSummary?: string
  compact: boolean
  searchExpanded: boolean
  onScopeChange: (scope: MailScope) => void
  onSearchChange: (search: string) => void
  onUnreadOnlyChange: (unreadOnly: boolean) => void
  onSearchExpandedChange: (expanded: boolean) => void
  onOpenFilters?: () => void
  onClearFilters?: () => void
  onClearSelection: () => void
}

/**
 * Controlled header state copied from Zero: selection replaces search/filter
 * controls. Compact search follows Cloudflare's reversible icon expansion.
 */
export function MailListToolbar({
  scope,
  search,
  unreadOnly,
  selectedCount,
  filterSummary,
  compact,
  searchExpanded,
  onScopeChange,
  onSearchChange,
  onUnreadOnlyChange,
  onSearchExpandedChange,
  onOpenFilters,
  onClearFilters,
  onClearSelection,
}: MailListToolbarProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    if (selectedCount > 0) onClearSelection()
    else if (search) onSearchChange('')
    else if (searchExpanded) onSearchExpandedChange(false)
  }

  return (
    <div onKeyDown={handleKeyDown} className="shrink-0 space-y-2 border-b p-3">
      <div className="flex min-h-7 items-center gap-2">
        {selectedCount > 0 ? (
          <>
            <span className="text-sm font-medium tabular-nums">
              {selectedCount} selected
            </span>
            <span className="text-xs text-muted-foreground">Esc to clear</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear selection"
              className="ml-auto"
              onClick={onClearSelection}
            >
              <X />
            </Button>
          </>
        ) : (
          <>
            <MailScopeTabs value={scope} onValueChange={onScopeChange} />
            <Label className="ml-auto flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              Unread
              <Switch
                size="sm"
                checked={unreadOnly}
                onCheckedChange={onUnreadOnlyChange}
              />
            </Label>
          </>
        )}
      </div>

      {selectedCount === 0 ? (
        <div className="flex items-center gap-1.5">
          {compact && !searchExpanded ? (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Search mail"
              onClick={() => onSearchExpandedChange(true)}
            >
              <Search />
            </Button>
          ) : (
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search mail"
                value={search}
                autoFocus={compact && searchExpanded}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search mail…"
                className="h-8 pr-8 pl-8 shadow-none"
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => onSearchChange('')}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          )}
          {onOpenFilters ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenFilters}
              className={cn(filterSummary && 'border-primary/40 bg-primary/5')}
            >
              <Filter />
              {!compact && (filterSummary || 'Filter')}
            </Button>
          ) : null}
          {filterSummary && onClearFilters ? (
            <Button variant="ghost" size="xs" onClick={onClearFilters}>
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}
      {filterSummary && selectedCount === 0 ? (
        <p className="truncate text-xs text-muted-foreground">
          {filterSummary}
        </p>
      ) : null}
    </div>
  )
}
