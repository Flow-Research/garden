import { useMemo } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Filter,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import type {
  IssueViewState,
  SortField,
} from '@garden/app-state/issues/stores/view-store'
import {
  CARD_PROPERTY_OPTIONS,
  SORT_OPTIONS,
} from '@garden/app-state/issues/stores/view-store'
import type { IssuesScope } from '@garden/app-state/issues/stores/issues-scope-store'
import type { Issue } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { Separator } from '@garden/ui/components/ui/separator'
import { Switch } from '@garden/ui/components/ui/switch'
import { cn } from '@garden/ui/lib/utils'
import { useIssuesHeaderViewState } from '../hooks/use-issues-view-state'
import {
  IssueFilterTray,
  countIssues,
  numberOfActiveFilters,
} from './issue-filter-tray'

const SCOPE_OPTIONS: readonly {
  description: string
  label: string
  value: IssuesScope
}[] = [
  { description: 'Every issue', label: 'All', value: 'all' },
  { description: 'Assigned to people', label: 'Members', value: 'members' },
  { description: 'Assigned to agents', label: 'Agents', value: 'agents' },
]

function DisplaySettings({
  actions,
  state,
}: {
  actions: IssueViewState
  state: Pick<IssueViewState, 'cardProperties' | 'sortBy' | 'sortDirection'>
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Display</p>
        <p className="text-xs text-muted-foreground">
          Ordering and card detail
        </p>
      </div>
      <label className="block space-y-1.5 text-xs text-muted-foreground">
        Order by
        <div className="flex gap-2">
          <select
            className="h-8 flex-1 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) =>
              actions.setSortBy(event.currentTarget.value as SortField)
            }
            value={state.sortBy}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            aria-label={
              state.sortDirection === 'asc'
                ? 'Sort ascending'
                : 'Sort descending'
            }
            onClick={() =>
              actions.setSortDirection(
                state.sortDirection === 'asc' ? 'desc' : 'asc',
              )
            }
            size="icon-sm"
            variant="outline"
          >
            {state.sortDirection === 'asc' ? (
              <ArrowUp className="size-3.5" />
            ) : (
              <ArrowDown className="size-3.5" />
            )}
          </Button>
        </div>
      </label>
      <Separator />
      <div className="space-y-2.5">
        {CARD_PROPERTY_OPTIONS.map((property) => (
          <label
            className="flex cursor-pointer items-center justify-between text-sm"
            key={property.key}
          >
            {property.label}
            <Switch
              checked={state.cardProperties[property.key]}
              onCheckedChange={() => actions.toggleCardProperty(property.key)}
              size="sm"
            />
          </label>
        ))}
      </div>
    </div>
  )
}

/** Issues toolbar with compact scopes, search, and Garden-owned popover trays. */
export function IssuesHeader({
  onCreateIssue,
  onSearchQueryChange,
  scopedIssues,
  searchQuery,
}: {
  onCreateIssue: (data?: Record<string, unknown> | null) => void
  onSearchQueryChange: (query: string) => void
  scopedIssues: Issue[]
  searchQuery: string
}) {
  const view = useIssuesHeaderViewState()
  const counts = useMemo(() => countIssues(scopedIssues), [scopedIssues])
  const filterCount = numberOfActiveFilters(view)

  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-4 py-2">
      <div
        aria-label="Issue scope"
        className="flex rounded-lg border bg-muted/30 p-0.5"
        role="group"
      >
        {SCOPE_OPTIONS.map((option) => (
          <Button
            aria-label={`${option.label}: ${option.description}`}
            aria-pressed={view.scope === option.value}
            className={cn(
              'h-7 border-0 px-2.5 text-xs shadow-none',
              view.scope === option.value
                ? 'bg-background text-foreground shadow-sm'
                : 'bg-transparent text-muted-foreground hover:bg-background/60',
            )}
            key={option.value}
            onClick={() => view.setScope(option.value)}
            size="sm"
            variant="outline"
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="relative min-w-36 max-w-md flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search issues"
          className="h-8 bg-background pl-8 pr-8 shadow-none"
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onSearchQueryChange('')
          }}
          placeholder="Search issues"
          value={searchQuery}
        />
        {searchQuery ? (
          <Button
            aria-label="Clear issue search"
            className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
            onClick={() => onSearchQueryChange('')}
            size="icon-sm"
            variant="ghost"
          >
            <X className="size-3" />
          </Button>
        ) : null}
      </div>

      <Button className="gap-1.5" onClick={() => onCreateIssue()} size="sm">
        <Plus className="size-3.5" />
        <span className="hidden sm:inline">New issue</span>
      </Button>

      <Popover>
        <PopoverTrigger
          render={
            <Button
              aria-label="Filters"
              className="relative gap-1.5"
              size="sm"
              variant="outline"
            >
              <Filter className="size-3.5" />
              <span className="hidden lg:inline">Filters</span>
              {filterCount ? (
                <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                  {filterCount}
                </span>
              ) : null}
            </Button>
          }
        />
        <PopoverContent
          align="end"
          className="max-h-[min(70vh,38rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto p-4"
        >
          <IssueFilterTray
            actions={view.actions}
            counts={counts}
            state={view}
          />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger
          render={
            <Button
              aria-label="Display settings"
              size="icon-sm"
              variant="outline"
            >
              <SlidersHorizontal className="size-3.5" />
            </Button>
          }
        />
        <PopoverContent align="end" className="w-64 p-4">
          <DisplaySettings actions={view.actions} state={view} />
        </PopoverContent>
      </Popover>

      <Button
        aria-label={
          view.viewMode === 'board'
            ? 'Switch to list view'
            : 'Switch to board view'
        }
        onClick={() =>
          view.actions.setViewMode(view.viewMode === 'board' ? 'list' : 'board')
        }
        size="icon-sm"
        variant="outline"
      >
        {view.viewMode === 'board' ? (
          <Columns3 className="size-3.5" />
        ) : (
          <List className="size-3.5" />
        )}
      </Button>
    </header>
  )
}
