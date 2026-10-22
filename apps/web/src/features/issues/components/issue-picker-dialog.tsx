import { useEffect } from 'react'
import type { Issue } from '@garden/core/types'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@garden/ui/components/ui/command'
import { useIssueSearch } from '../hooks/use-issue-search'
import { StatusIcon } from './status-icon'

/** Command-palette dialog for picking another issue (parent / sub-issue). */
export function IssuePickerDialog({
  open,
  onOpenChange,
  title,
  description,
  excludeIds,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  excludeIds: string[]
  onSelect: (issue: Issue) => void
}) {
  const { query, results, isLoading, setQuery, reset } = useIssueSearch({
    excludeIds,
  })

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      reset()
    }
  }, [open, reset])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search issues..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {isLoading && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          )}
          {!isLoading && query.trim() && results.length === 0 && (
            <CommandEmpty>No issues found.</CommandEmpty>
          )}
          {!isLoading && !query.trim() && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Type to search issues
            </div>
          )}
          {results.length > 0 && (
            <CommandGroup>
              {results.map((issue) => (
                <CommandItem
                  key={issue.id}
                  value={issue.id}
                  onSelect={() => {
                    onSelect(issue)
                    onOpenChange(false)
                  }}
                >
                  <StatusIcon
                    status={issue.status}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="text-muted-foreground shrink-0">
                    {issue.identifier}
                  </span>
                  <span className="truncate">{issue.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
