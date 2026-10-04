import { useMemo } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Columns3,
  Filter,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
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
  { description: 'Assigned to agents', label: 'Agents', value: 'agents' },
  { description: 'Assigned to people', label: 'Members', value: 'members' },
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
  const navigate = useNavigate()
  const counts = useMemo(() => countIssues(scopedIssues), [scopedIssues])
  const filterCount = numberOfActiveFilters(view)

  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-4 py-2">
      <div
        aria-label="Issue scope"
        className="flex h-[35px] items-center rounded-sm bg-background-main-secondary p-1"
        role="group"
      >
        {SCOPE_OPTIONS.map((option) => (
          <Button
            aria-label={`${option.label}: ${option.description}`}
            aria-pressed={view.scope === option.value}
            className={cn(
              'h-[27px] rounded-sm border-0 px-2.5 text-sm font-normal shadow-none',
              view.scope === option.value
                ? 'bg-background-brand-default text-text-brand-onBrand'
                : 'bg-transparent text-text-default hover:bg-background-main-secondary-hover',
            )}
            key={option.value}
            onClick={() => view.setScope(option.value)}
            variant="outline"
          >
            {option.label}
          </Button>
        ))}
      </div>

      {/* Design's "Internal Tasks ▾" view switcher — Issues is the current
          surface; External Tasks maps to the existing Workflows page and
          System is a disabled design placeholder. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              className="h-[35px] gap-1.5 rounded-md px-3 text-sm font-normal shadow-1"
            >
              Issues
              <ChevronDown className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem className="justify-between" disabled>
            Issues
            <Check className="size-4" />
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void navigate({ to: '/workflows' })}
          >
            Workflows
          </DropdownMenuItem>
          <DropdownMenuItem disabled>System</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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

      <Button
        className="h-10 gap-2 rounded-md px-3"
        onClick={() => onCreateIssue()}
      >
        <Plus className="size-4" />
        <span className="hidden sm:inline">New issue</span>
      </Button>

      <Popover>
        <PopoverTrigger
          render={
            <Button
              aria-label="Filters"
              className="relative"
              size="icon-sm"
              variant="outline"
            >
              <Filter className="size-4" />
              {filterCount ? (
                <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
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
