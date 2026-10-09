import { useMemo } from 'react'
import { Columns3, Database, Funnel, List, Plus, Search } from 'lucide-react'
import type { Issue } from '@garden/core/types'
import {
  useViewStore,
  useViewStoreApi,
} from '@garden/app-state/issues/stores/view-store-context'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { cn } from '@garden/ui/lib/utils'
import {
  IssueFilterTray,
  countIssues,
  numberOfActiveFilters,
} from '@/features/issues/components/issue-filter-tray'

/** Design pill tab chrome shared by the Team detail and member tabs. */
export const TEAM_TABS_LIST_CLASS =
  'h-auto gap-2 rounded-none bg-transparent p-0'

export const TEAM_TAB_TRIGGER_CLASS = cn(
  'h-8 gap-2 rounded-pill border-[0.5px] border-border-default bg-background-main-secondary px-4 text-sm font-normal text-text-default',
  'data-active:border-border-brand-secondary data-active:bg-background-brand-tertiary data-active:text-text-brand-secondary',
  'group-data-[variant=default]/tabs-list:data-active:shadow-none',
  'dark:text-text-default dark:hover:text-text-default',
  'dark:data-active:bg-background-brand-tertiary dark:data-active:text-text-brand-secondary',
)

/** Design toolbar buttons: transparent, hairline border, secondary text. */
export const TOOLBAR_BUTTON_CLASS =
  'h-8 gap-2 rounded-md border-[0.5px] border-border-default bg-transparent px-3 text-sm font-normal text-text-secondary shadow-none hover:bg-background-main-secondary'

/** Design search field: gray fill, no border, leading search glyph. */
export function SearchField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <div className="relative w-[21.25rem] max-w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-icon-secondary" />
      <Input
        aria-label={label}
        className="h-8 rounded-md border-0 bg-background-main-secondary pl-9 shadow-none placeholder:text-text-secondary"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </div>
  )
}

/** Export Data is P1 in the spec, so it renders disabled per the design. */
export function ExportDataButton() {
  return (
    <Button className={TOOLBAR_BUTTON_CLASS} disabled variant="outline">
      <Database className="size-4" />
      Export Data
    </Button>
  )
}

/**
 * List/board toggle for the Team issues surfaces. Replaces the old
 * Issues/Tasks pill split: there is one Issues view now and this button flips
 * it between the list and the kanban board. Reads/writes the surrounding
 * view-store provider so the toggle, the toolbar filters, and the panel below
 * stay on the same state. Mirrors the icon-button toggle in the workspace
 * Issues header.
 */
export function ViewModeToggle() {
  const viewMode = useViewStore((s) => s.viewMode)
  const actions = useViewStoreApi().getState()
  return (
    <Button
      aria-label={
        viewMode === 'board' ? 'Switch to list view' : 'Switch to board view'
      }
      className={TOOLBAR_BUTTON_CLASS}
      onClick={() =>
        actions.setViewMode(viewMode === 'board' ? 'list' : 'board')
      }
      variant="outline"
    >
      {viewMode === 'board' ? (
        <List className="size-4" />
      ) : (
        <Columns3 className="size-4" />
      )}
    </Button>
  )
}

/**
 * Issues toolbar shared by the Team detail tab and the member Teams view.
 * Lives inside the shared `teamIssueViewStore` provider so its Filter
 * popover, the view toggle, and the panel below read the same view state.
 */
export function IssuesToolbar({
  issues,
  onCreateIssue,
  onSearchChange,
  search,
}: {
  issues: Issue[]
  onCreateIssue: () => void
  onSearchChange: (value: string) => void
  search: string
}) {
  const actions = useViewStoreApi().getState()
  const statusFilters = useViewStore((s) => s.statusFilters)
  const priorityFilters = useViewStore((s) => s.priorityFilters)
  const assigneeFilters = useViewStore((s) => s.assigneeFilters)
  const includeNoAssignee = useViewStore((s) => s.includeNoAssignee)
  const creatorFilters = useViewStore((s) => s.creatorFilters)
  const projectFilters = useViewStore((s) => s.projectFilters)
  const includeNoProject = useViewStore((s) => s.includeNoProject)
  const counts = useMemo(() => countIssues(issues), [issues])
  const filterCount = numberOfActiveFilters({
    statusFilters,
    priorityFilters,
    assigneeFilters,
    includeNoAssignee,
    creatorFilters,
    projectFilters,
    includeNoProject,
  })

  return (
    <div className="flex items-center gap-3">
      <SearchField
        label="Search issues"
        onChange={onSearchChange}
        placeholder="Search issues..."
        value={search}
      />
      <Popover>
        <PopoverTrigger
          render={
            <Button className={TOOLBAR_BUTTON_CLASS} variant="outline">
              <Funnel className="size-4" />
              Filter
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
            actions={actions}
            counts={counts}
            state={{
              statusFilters,
              priorityFilters,
              assigneeFilters,
              includeNoAssignee,
              creatorFilters,
              projectFilters,
              includeNoProject,
            }}
          />
        </PopoverContent>
      </Popover>
      <ExportDataButton />
      <ViewModeToggle />
      <Button className="h-8 gap-2 rounded-md px-3" onClick={onCreateIssue}>
        <Plus className="size-4" />
        New Issue
      </Button>
    </div>
  )
}
